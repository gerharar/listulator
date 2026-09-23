import type { FastifyPluginAsync } from 'fastify'
import { dismissalTitleKey, type ItemSource } from '../db/schema.js'
import { getCurrentUser } from '../auth/currentUser.js'
import {
  clearDismissals,
  createList,
  createListItem,
  createListSnapshot,
  findDismissals,
  findList,
  findListItems,
  findLists,
  findListWithStats,
} from '../catalog/repository.js'
import { sendApiError } from '../apiErrors.js'
import {
  canonicalPathFromExternalRef,
  CustomListParseError,
  expandCanonicalList,
  fetchCanonicalList,
  isSafeCanonicalPath,
  parseCustomList,
  searchCanonicalLists,
  type ParsedCustomList,
} from './customLists.js'
import { IngestionError } from './http.js'
import { listsDropDir as defaultListsDropDir, scanListsDropFolder } from './listsDropFolder.js'
import type { AppDatabase } from '../db/client.js'
import type { MediaTypeRegistry } from './mediaTypes.js'
import type { List, ListSource, User } from '../db/schema.js'

export interface IngestionRoutesOptions {
  db: AppDatabase
  mediaTypes: MediaTypeRegistry
  /** Overridable so tests can scan a fixture directory instead of the real one. */
  listsDropDir?: string
}

interface ImportItem {
  title: string
  timeToConsumeMinutes?: number
  externalRef?: string
  year?: number
  group?: string
  tags?: string[]
  /** Curator-authored disambiguation prose, capped at 2048 characters. Never adapter-set. */
  notes?: string
}

export const ingestionRoutes: FastifyPluginAsync<IngestionRoutesOptions> = async (
  app,
  { db, mediaTypes, listsDropDir },
) => {
  /**
   * Shared by `/lists/from-file`, `/lists/scan-folder`, and
   * `/lists/from-canonical` — creates a list and its items from an
   * already-parsed, already-validated custom list. `parsed.category` is
   * guaranteed to be a real registry key by `parseCustomList` itself, so
   * the lookup here cannot fail.
   */
  async function importParsedList(
    user: User,
    parsed: ParsedCustomList,
    {
      source = 'file',
      externalRef,
      sourceYaml,
    }: { source?: ListSource; externalRef?: string; sourceYaml?: string } = {},
  ) {
    const mediaType = mediaTypes.get(parsed.category)!

    const list = await createList(db, user.id, {
      title: parsed.title,
      description: parsed.description ?? null,
      mediaType: parsed.category,
      source,
      ...(externalRef ? { externalRef } : {}),
      status: parsed.status ?? null,
      // `canonical`/`file` need no arrived_* or snapshot (D4) — re-parsing
      // the source YAML already gives these back. Only `sourceYaml` is
      // ever passed here, and only for `source: 'file'`.
      ...(sourceYaml !== undefined ? { sourceYaml } : {}),
    })

    // Sequential, not Promise.all — see the from-source route above for why.
    for (const item of parsed.items) {
      const known = item.minutes !== undefined

      await createListItem(db, user.id, list.id, {
        title: item.title,
        timeToConsumeMinutes: known ? item.minutes! : mediaType.defaultDurationMinutes,
        timeToConsumeIsEstimated: !known,
        ...(item.year !== undefined ? { year: item.year } : {}),
        ...(item.group !== undefined ? { group: item.group } : {}),
        ...(item.tags !== undefined ? { tags: item.tags } : {}),
        ...(item.notes !== undefined ? { notes: item.notes } : {}),
        source: 'import',
      })
    }

    return list
  }

  /**
   * The "has this changed" half of task 7.6's update notification — same
   * new-item matching (title-only, dismissals excluded) as
   * `/lists/:listId/refresh`'s canonical branch, but a boolean rather than
   * the full diff, since the caller here is checking many lists at once
   * rather than previewing one.
   *
   * Degrades silently on any fetch/parse failure, unlike the refresh
   * route's explicit-action 502 — this runs automatically (app open, or
   * "sync now" across every synced list at once), so one transient GitHub
   * hiccup on one list must not make the whole check look broken, the same
   * reasoning `searchCanonicalLists` already uses (task 7.4).
   */
  async function hasCanonicalUpdate(user: User, list: List): Promise<boolean> {
    const canonicalPath = canonicalPathFromExternalRef(list.externalRef)
    if (!canonicalPath || !isSafeCanonicalPath(canonicalPath)) return false

    let upstream
    try {
      upstream = await expandCanonicalList(
        canonicalPath,
        new Set(mediaTypes.list().map((entry) => entry.key)),
      )
    } catch {
      return false
    }

    const existing = (await findListItems(db, user.id, list.id)) ?? []
    const knownTitles = new Set(existing.map((item) => dismissalTitleKey(item.title)))

    const dismissed = await findDismissals(db, user.id, list.id)
    const dismissedTitles = new Set(dismissed.map((item) => item.titleKey))

    return upstream.some((candidate) => {
      const titleKey = dismissalTitleKey(candidate.title)
      return !knownTitles.has(titleKey) && !dismissedTitles.has(titleKey)
    })
  }

  // Upstream being down or rate-limiting is not a bug in this app, and the
  // message says which service and what to do about it.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IngestionError) {
      return reply.code(502).send({ error: 'Upstream unavailable', message: error.message })
    }

    request.log.error(error)
    return reply.send(error)
  })

  /**
   * Finds things that could become a whole list — an artist, a filmography —
   * rather than individual items. See SearchAdapter.
   *
   * Also matches canonical-repo list titles in this category (task 7.4,
   * `docs/intent/custom-lists.md`) and merges them in — the actual confirmed
   * intent behind canonical lists ("when a user searches for something, the
   * app looks up if the search terms match anything from canonical lists in
   * a given category"), not a separate browse UI. This is why a category
   * with no credentialed adapter can still return results: a canonical
   * match alone is enough, so `search.unavailable` only fires when *neither*
   * source found anything.
   */
  app.get<{
    Params: { key: string }
    Querystring: { q?: string; language?: string; includeUnknown?: string }
  }>('/media-types/:key/search', async (request, reply) => {
    getCurrentUser(request)

    const mediaType = mediaTypes.get(request.params.key)
    if (!mediaType) return reply.callNotFound()

    const query = request.query.q?.trim()
    if (!query) return sendApiError(reply, 400, 'search.queryRequired')

    const canonicalMatches = await searchCanonicalLists(mediaType.key, query)

    if (!mediaType.adapter?.isAvailable()) {
      if (canonicalMatches.length === 0) {
        // Not an error: plenty of categories will never have search, and the
        // manual path always works.
        return sendApiError(reply, 409, 'search.unavailable', { category: mediaType.label })
      }
      return { sources: canonicalMatches }
    }

    // Book-only GUI options (never sent for any other category) — every
    // other adapter's search() ignores this second argument entirely.
    const searchOptions = {
      ...(request.query.language ? { language: request.query.language } : {}),
      includeUnknown: request.query.includeUnknown === 'true',
    }

    return {
      sources: [...canonicalMatches, ...(await mediaType.adapter.search(query, searchOptions))],
    }
  })

  /**
   * Creates a list from a searched source, importing everything it expands to.
   * One step rather than preview-then-import: the list is trivially deletable,
   * and its items are editable once it exists.
   */
  app.post<{
    Body: {
      mediaType: string
      externalRef: string
      title: string
      language?: string
      includeUnknown?: boolean
      includeEp?: boolean
      includeSingle?: boolean
      includeLive?: boolean
      includeCompilation?: boolean
    }
  }>(
    '/lists/from-source',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mediaType', 'externalRef', 'title'],
          additionalProperties: false,
          properties: {
            mediaType: { type: 'string', minLength: 1 },
            externalRef: { type: 'string', minLength: 1, maxLength: 500 },
            title: { type: 'string', minLength: 1, maxLength: 500 },
            // Book-only GUI options (never sent for any other category) —
            // appended to the stored externalRef below so a later refresh
            // replays the same filter, rather than needing their own column.
            language: { type: 'string', minLength: 1, maxLength: 20 },
            includeUnknown: { type: 'boolean' },
            // Music-only GUI options (never sent for any other category) —
            // same append-to-externalRef technique as the language filter
            // above. See musicbrainz.ts's `parseRef`/FACETS.
            includeEp: { type: 'boolean' },
            includeSingle: { type: 'boolean' },
            includeLive: { type: 'boolean' },
            includeCompilation: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const {
        mediaType: key,
        externalRef,
        title,
        language,
        includeUnknown,
        includeEp,
        includeSingle,
        includeLive,
        includeCompilation,
      } = request.body

      const mediaType = mediaTypes.get(key)
      if (!mediaType) return sendApiError(reply, 400, 'list.unknownCategory', { key })

      // A canonical-repo search result (task 7.4) — reuses 7.2's
      // parser/import path entirely rather than the adapter's own
      // `expand()`. `parsed.title` is used, not the request body's `title`
      // (an echoed-back search-result label): the file's own title is the
      // authoritative one, same rule `/lists/from-file` and
      // `/lists/scan-folder` already follow.
      const canonicalPath = canonicalPathFromExternalRef(externalRef)
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) return sendApiError(reply, 400, 'list.fileInvalid')

        let parsed: ParsedCustomList
        try {
          parsed = await fetchCanonicalList(
            canonicalPath,
            new Set(mediaTypes.list().map((entry) => entry.key)),
          )
        } catch (cause) {
          if (cause instanceof CustomListParseError) {
            return sendApiError(reply, 400, cause.code, cause.params)
          }
          throw cause
        }

        const list = await importParsedList(user, parsed, { source: 'canonical', externalRef })
        return reply.code(201).send(await findListWithStats(db, user.id, list.id))
      }

      if (!mediaType.adapter?.isAvailable()) {
        return sendApiError(reply, 409, 'search.unavailable', { category: mediaType.label })
      }

      // The language filter (and its "include unknown" flag) become part
      // of the *stored* ref, not separate fields — so
      // /lists/:listId/refresh (which just replays `list.externalRef`
      // through the same adapter-shaped `expand()`, unchanged) automatically
      // re-applies the same filter later, with no route or schema changes
      // needed there. The music discography-type toggles below follow the
      // exact same technique, and — like the language filter — are gated on
      // whether the GUI actually sent them, not on `mediaType`: the route
      // doesn't know or care which category reads these, only MusicBrainz's
      // adapter does, but plenty of route tests reuse the `music` key as a
      // generic stand-in category with a fake adapter that doesn't, and
      // gating on the key would silently rope those into this branch too.
      const includeEpSent = includeEp !== undefined
      const includeSingleSent = includeSingle !== undefined
      const includeLiveSent = includeLive !== undefined
      const includeCompilationSent = includeCompilation !== undefined
      const musicFacets =
        includeEpSent || includeSingleSent || includeLiveSent || includeCompilationSent
          ? [
              // EPs and singles on by default, live and compilations off —
              // confirmed with the user.
              (includeEp ?? true) && 'ep',
              (includeSingle ?? true) && 'single',
              includeLive && 'live',
              includeCompilation && 'compilation',
            ].filter((facet): facet is string => facet !== false)
          : null

      const refForAdapter =
        language && language !== 'all'
          ? `${externalRef}:${language}${includeUnknown ? ':unknown' : ''}`
          : musicFacets
            ? `${externalRef}:${musicFacets.join(',')}`
            : externalRef

      // Expanded before the list is created, so a failure upstream does not
      // leave an empty list behind.
      const candidates = await mediaType.adapter.expand(refForAdapter)
      if (candidates.length === 0) {
        return sendApiError(reply, 422, 'list.sourceEmpty', { title })
      }

      const list = await createList(db, user.id, {
        title,
        mediaType: key,
        source: 'api',
        externalRef: refForAdapter,
        // No adapter sets description/status, so both are null at import
        // time — arrived_* mirrors that, same as the real columns (D4).
        arrivedTitle: title,
        arrivedDescription: null,
        arrivedStatus: null,
      })

      // Sequential, not Promise.all: each create can fall back to
      // nextOrderIndex's own read of the current max, and concurrent inserts
      // against that would race under an async driver.
      for (const candidate of candidates) {
        const known = candidate.timeToConsumeMinutes !== undefined

        await createListItem(db, user.id, list.id, {
          title: candidate.title,
          timeToConsumeMinutes: known
            ? candidate.timeToConsumeMinutes!
            : mediaType.defaultDurationMinutes,
          timeToConsumeIsEstimated: !known,
          ...(candidate.externalRef ? { externalRef: candidate.externalRef } : {}),
          ...(candidate.year ? { year: candidate.year } : {}),
          ...(candidate.group ? { group: candidate.group } : {}),
          ...(candidate.tags ? { tags: candidate.tags } : {}),
          ...(candidate.notes ? { notes: candidate.notes } : {}),
          source: 'import',
        })
      }

      // The arrived-state snapshot (D4), written once — built from the
      // items just created, not re-derived from `candidates`, so it can
      // never drift from what's actually in `list_items`.
      const createdItems = await findListItems(db, user.id, list.id)
      await createListSnapshot(db, list.id, createdItems ?? [])

      return reply.code(201).send(await findListWithStats(db, user.id, list.id))
    },
  )

  /**
   * Creates a list from a pasted or uploaded custom-list YAML file
   * (`docs/intent/custom-lists.md`, task 7.2). One-time import, like manual
   * entry — no `externalRef`, so it gets the same "nothing to refresh
   * against" behaviour as a hand-made list for free; there is no stable
   * upstream to refetch from (that's what 7.4/7.5's canonical sync is for).
   */
  app.post<{ Body: { yaml: string } }>(
    '/lists/from-file',
    {
      schema: {
        body: {
          type: 'object',
          required: ['yaml'],
          additionalProperties: false,
          properties: { yaml: { type: 'string', minLength: 1, maxLength: 200_000 } },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)

      let parsed: ParsedCustomList
      try {
        parsed = parseCustomList(
          request.body.yaml,
          new Set(mediaTypes.list().map((entry) => entry.key)),
        )
      } catch (cause) {
        if (cause instanceof CustomListParseError) {
          return sendApiError(reply, 400, cause.code, cause.params)
        }
        throw cause
      }

      const list = await importParsedList(user, parsed, { sourceYaml: request.body.yaml })
      return reply.code(201).send(await findListWithStats(db, user.id, list.id))
    },
  )

  /**
   * Scans the configured drop folder (`list_customs/` by default, task 7.3)
   * for `.yaml`/`.yml` files and imports each valid one through the same
   * path as `/lists/from-file`. Triggered on demand (a "check folder"
   * action) rather than by background polling — the confirmed constraint
   * in `docs/intent/custom-lists.md`. A file that fails to parse is reported
   * here, not silently skipped, and moves to `refused_entry/` alongside the
   * reason; either way it leaves the drop folder so a repeat scan cannot
   * reprocess it.
   */
  app.post('/lists/scan-folder', async (request, reply) => {
    const user = getCurrentUser(request)

    const outcomes = scanListsDropFolder(
      listsDropDir ?? defaultListsDropDir(),
      new Set(mediaTypes.list().map((entry) => entry.key)),
    )

    const created = []
    const failed = []

    for (const outcome of outcomes) {
      if (outcome.result.ok) {
        const list = await importParsedList(user, outcome.result.list, {
          sourceYaml: outcome.result.rawText,
        })
        created.push({ fileName: outcome.fileName, id: list.id, title: list.title })
      } else {
        failed.push({
          fileName: outcome.fileName,
          code: outcome.result.error.code,
          ...(outcome.result.error.params ? { params: outcome.result.error.params } : {}),
        })
      }
    }

    return reply.code(created.length > 0 ? 201 : 200).send({ created, failed })
  })

  /**
   * Reports what a list's source has that the list does not.
   *
   * Deliberately a dry run: it changes nothing and the caller decides what to
   * add, using the ordinary import endpoint. Applying automatically would
   * quietly undo pruning — deleting the entries an import brought in that you
   * never intended to finish is a supported workflow, and a refresh that put
   * them all back would make it pointless.
   */
  app.post<{ Params: { listId: string }; Body?: { includeDismissed?: boolean } }>(
    '/lists/:listId/refresh',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { includeDismissed: { type: 'boolean' } },
          nullable: true,
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId } = request.params

      const list = await findList(db, user.id, listId)
      if (!list) return reply.callNotFound()

      if (!list.externalRef) {
        return sendApiError(reply, 409, 'refresh.handMadeList')
      }

      // A synced canonical list (task 7.4's `canonical:<path>` externalRef)
      // refetches and reparses the file directly, the same `expand()`-shaped
      // path task 6.8 proved out for a real adapter — the ordinary
      // `mediaType.adapter.expand()` below would otherwise receive a ref its
      // real adapter (TMDB, Open Library, whichever) was never built to
      // understand.
      const canonicalPath = canonicalPathFromExternalRef(list.externalRef)

      let upstream
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) return sendApiError(reply, 400, 'list.fileInvalid')

        try {
          upstream = await expandCanonicalList(
            canonicalPath,
            new Set(mediaTypes.list().map((entry) => entry.key)),
          )
        } catch (cause) {
          if (cause instanceof CustomListParseError) {
            return sendApiError(reply, 400, cause.code, cause.params)
          }
          throw cause
        }
      } else {
        const mediaType = mediaTypes.get(list.mediaType)
        if (!mediaType?.adapter?.isAvailable()) {
          return sendApiError(reply, 409, 'refresh.searchUnavailable', {
            category: mediaType?.label ?? list.mediaType,
          })
        }

        upstream = await mediaType.adapter.expand(list.externalRef)
      }
      const existing = (await findListItems(db, user.id, listId)) ?? []

      // Matched on the upstream id where there is one, and on title otherwise:
      // Wikipedia events and Open Library works carry no stable id.
      const knownRefs = new Set(existing.map((item) => item.externalRef).filter(Boolean))
      const knownTitles = new Set(existing.map((item) => dismissalTitleKey(item.title)))

      // Things deleted by hand, which a refresh must not keep offering back —
      // otherwise pruning an import never sticks. Ticking the box ignores
      // them, which is both the undo for an accidental delete and the way out
      // if a shared title over-suppressed something.
      const dismissed = request.body?.includeDismissed
        ? []
        : await findDismissals(db, user.id, listId)
      const dismissedRefs = new Set(dismissed.map((item) => item.externalRef).filter(Boolean))
      const dismissedTitles = new Set(dismissed.map((item) => item.titleKey))

      const newItems = upstream.filter((candidate) => {
        const titleKey = dismissalTitleKey(candidate.title)

        if (candidate.externalRef && knownRefs.has(candidate.externalRef)) return false
        if (knownTitles.has(titleKey)) return false
        if (candidate.externalRef && dismissedRefs.has(candidate.externalRef)) return false

        return !dismissedTitles.has(titleKey)
      })

      return {
        newItems,
        upstreamCount: upstream.length,
        existingCount: existing.length,
        dismissedCount: (await findDismissals(db, user.id, listId)).length,
      }
    },
  )

  /**
   * "This list was updated" notification (task 7.6) — on-trigger only (app
   * open, or an explicit "sync now"), never background polling, per the
   * confirmed constraint (docs/intent/custom-lists.md). Scoped to
   * canonical-synced lists only, deliberately not every externalRef-backed
   * list: checking every list's real API adapter (TMDB, IGDB, MusicBrainz,
   * Wikipedia, ...) on every app open would reintroduce the exact per-key
   * rate-limit pressure canonical lists exist to avoid.
   */
  app.get('/lists/updates', async (request) => {
    const user = getCurrentUser(request)

    const synced = (await findLists(db, user.id)).filter((list) =>
      canonicalPathFromExternalRef(list.externalRef),
    )

    const updates = []
    // Sequential, not Promise.all — see the from-source route above for why,
    // and to avoid firing every synced list's fetch at GitHub at once.
    for (const list of synced) {
      if (await hasCanonicalUpdate(user, list)) {
        updates.push({ listId: list.id, title: list.title })
      }
    }

    return { updates }
  })

  /**
   * The UI renders a bucket per category — including ones with no lists yet —
   * so it needs the whole registry, not just the categories in use.
   */
  app.get('/media-types', async () =>
    mediaTypes
      .list()
      .map(({ key, label, description, sortOrder, defaultDurationMinutes, adapter }) => ({
        key,
        label,
        ...(description ? { description } : {}),
        sortOrder,
        defaultDurationMinutes,
        // Whether search is offered for this category. Manual entry always works.
        searchAvailable: adapter?.isAvailable() ?? false,
      })),
  )

  /**
   * Bulk-adds items to a list — the single write path for every ingestion
   * route. Manual entry uses it directly today; Phase 3a's adapters will
   * resolve candidates and hand them to the same endpoint.
   *
   * Durations left out are filled from the category's default and marked
   * estimated, which is how `time_to_consume_minutes` stays NOT NULL without
   * the catalog ever inventing a number (SPEC.md §4, §5).
   */
  app.post<{ Params: { listId: string }; Body: { items: ImportItem[]; source?: ItemSource } }>(
    '/lists/:listId/items/import',
    {
      schema: {
        body: {
          type: 'object',
          required: ['items'],
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['title'],
                additionalProperties: false,
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 500 },
                  timeToConsumeMinutes: { type: 'integer', minimum: 0 },
                  externalRef: { type: 'string', maxLength: 500 },
                  year: { type: 'integer' },
                  group: { type: 'string', maxLength: 500 },
                  tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 40 } },
                  notes: { type: 'string', maxLength: 2048 },
                },
              },
            },
            // This one endpoint backs both manual list-creation's item
            // textarea and a refresh's "add what's new" button (task 6.2) —
            // the two are indistinguishable per item (Wikipedia/Open Library
            // imports carry no externalRef either), so the caller states
            // which this batch is. Defaults to 'import', the more common case.
            source: { type: 'string', enum: ['manual', 'import'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = getCurrentUser(request)
      const { listId } = request.params
      const source = request.body.source ?? 'import'

      const list = await findList(db, user.id, listId)
      if (!list) return reply.callNotFound()

      // A list's category is validated on write, but a registry entry can be
      // removed while lists still reference it; fall back rather than crash.
      const fallbackMinutes = mediaTypes.get(list.mediaType)?.defaultDurationMinutes ?? 30

      // Adding something back is the user changing their mind, so the record
      // that they once deleted it has to go with it.
      await clearDismissals(db, listId, request.body.items)

      // Sequential, not Promise.all — see the from-source route above for why.
      const created = []
      for (const item of request.body.items) {
        const known = item.timeToConsumeMinutes !== undefined

        created.push(
          await createListItem(db, user.id, listId, {
            title: item.title,
            timeToConsumeMinutes: known ? item.timeToConsumeMinutes! : fallbackMinutes,
            timeToConsumeIsEstimated: !known,
            ...(item.externalRef ? { externalRef: item.externalRef } : {}),
            ...(item.year ? { year: item.year } : {}),
            ...(item.group ? { group: item.group } : {}),
            ...(item.tags ? { tags: item.tags } : {}),
            ...(item.notes ? { notes: item.notes } : {}),
            source,
          }),
        )
      }

      return reply.code(201).send(created)
    },
  )
}
