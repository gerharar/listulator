import type { FastifyPluginAsync } from 'fastify'
import { dismissalTitleKey, type ItemSource } from '../db/schema.js'
import { getCurrentUser } from '../auth/currentUser.js'
import { MAX_ITEM_TAGS } from '../catalog/facets.js'
import {
  clearDismissals,
  createList,
  createListSnapshot,
  findDismissals,
  findList,
  findListItems,
  findListWithStats,
  findLists,
} from '../catalog/repository.js'
import { sendApiError } from '../apiErrors.js'
import {
  canonicalPathFromExternalRef,
  CustomListParseError,
  expandCanonicalList,
  fetchCanonicalList,
  fetchCanonicalManifest,
  isSafeCanonicalPath,
  parseCustomList,
  requireItems,
  untrackedLibraryEntries,
  type ParsedCustomList,
} from './customLists.js'
import { createListItems, discardList } from '../catalog/bulkItems.js'
import { seedGroupOrder } from '../catalog/groups.js'
import { expansionCacheKey, createExpansionCache } from './expansionCache.js'
import { IngestionError } from './http.js'
import { listsDropDir as defaultListsDropDir, scanListsDropFolder } from './listsDropFolder.js'
import type { AppDatabase } from '../db/client.js'
import { toMediaTypeInfo, type MediaTypeRegistry } from './mediaTypes.js'
import { expandSource, SourceUnavailableError, UnsafeSourceError } from './expandSource.js'
import { refForAdapter } from './sourceRef.js'
import { searchSources, SearchUnavailableError } from './search.js'
import type { ListSource, User } from '../db/schema.js'

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
  // One per app instance, so tests and servers never share it (task 10.15).
  const expansions = createExpansionCache()

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

    // One bulk insert, and a failure removes the list just made (see the from-source route above).
    try {
      await createListItems(
        db,
        user.id,
        list.id,
        parsed.items.map((item) => {
          const known = item.minutes !== undefined

          return {
            title: item.title,
            timeToConsumeMinutes: known ? item.minutes! : mediaType.defaultDurationMinutes,
            timeToConsumeIsEstimated: !known,
            ...(item.year !== undefined ? { year: item.year } : {}),
            ...(item.group !== undefined ? { group: item.group } : {}),
            ...(item.tags !== undefined ? { tags: item.tags } : {}),
            ...(item.notes !== undefined ? { notes: item.notes } : {}),
            source: 'import' as const,
          }
        }),
      )

      await seedGroupOrder(db, list.id)
    } catch (error) {
      await discardList(db, user.id, list.id)
      throw error
    }

    return list
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

    // Book-only GUI options (never sent for any other category) — every
    // other adapter's search() ignores this second argument entirely.
    const searchOptions = {
      ...(request.query.language ? { language: request.query.language } : {}),
      includeUnknown: request.query.includeUnknown === 'true',
    }

    try {
      return await searchSources(mediaType, query, searchOptions)
    } catch (cause) {
      if (cause instanceof SearchUnavailableError) {
        return sendApiError(reply, 409, cause.code, { category: mediaType.label })
      }
      throw cause
    }
  })

  /**
   * Expands one search result *without creating anything*: its item count and,
   * where the source has an honest signal, its production status (task 10.12,
   * Q11 — the Search tab fetches this for every result after the rows render).
   * Takes the same filters an import does and expands with the same ref, so
   * the number shown is the number "Add list" produces. Named for what it
   * returns rather than "count", so 10.15's Preview can widen it to the items.
   */
  app.get<{
    Params: { key: string }
    Querystring: {
      externalRef: string
      language?: string
      includeUnknown?: boolean
      includeEp?: boolean
      includeSingle?: boolean
      includeLive?: boolean
      includeCompilation?: boolean
      /** Preview (task 10.15): also return the items, not just the count. */
      items?: boolean
    }
  }>(
    '/media-types/:key/expansion',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['externalRef'],
          properties: {
            externalRef: { type: 'string', minLength: 1 },
            language: { type: 'string' },
            includeUnknown: { type: 'boolean' },
            includeEp: { type: 'boolean' },
            includeSingle: { type: 'boolean' },
            includeLive: { type: 'boolean' },
            includeCompilation: { type: 'boolean' },
            items: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      getCurrentUser(request)

      const mediaType = mediaTypes.get(request.params.key)
      if (!mediaType) return reply.callNotFound()

      const { externalRef, items: withItems, ...options } = request.query

      try {
        const { items, status } = await expandSource(
          mediaType,
          externalRef,
          options,
          new Set(mediaTypes.list().map((entry) => entry.key)),
          expansions,
        )

        return {
          itemCount: items.length,
          ...(status ? { status } : {}),
          ...(withItems ? { items } : {}),
        }
      } catch (cause) {
        if (cause instanceof SourceUnavailableError) {
          return sendApiError(reply, 409, 'search.unavailable', { category: mediaType.label })
        }
        if (cause instanceof UnsafeSourceError) return sendApiError(reply, 400, 'list.fileInvalid')
        if (cause instanceof CustomListParseError) {
          return sendApiError(reply, 400, cause.code, cause.params)
        }
        throw cause
      }
    },
  )

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

      // The language filter and the music discography toggles become part of
      // the *stored* ref, so /lists/:listId/refresh replays them later with no
      // route or schema changes — see `refForAdapter` (sourceRef.ts).
      const adapterRef = refForAdapter(externalRef, {
        ...(language !== undefined ? { language } : {}),
        ...(includeUnknown !== undefined ? { includeUnknown } : {}),
        ...(includeEp !== undefined ? { includeEp } : {}),
        ...(includeSingle !== undefined ? { includeSingle } : {}),
        ...(includeLive !== undefined ? { includeLive } : {}),
        ...(includeCompilation !== undefined ? { includeCompilation } : {}),
      })

      // Expanded before the list is created, so a failure upstream does not
      // leave an empty list behind.
      const cacheKey = expansionCacheKey(key, adapterRef)
      const adapter = mediaType.adapter
      const { items: candidates, status } = await expansions.get(cacheKey, () =>
        adapter.expand(adapterRef),
      )
      if (candidates.length === 0) {
        return sendApiError(reply, 422, 'list.sourceEmpty', { title })
      }

      const list = await createList(db, user.id, {
        title,
        mediaType: key,
        source: 'api',
        externalRef: adapterRef,
        // No adapter sets a description. Status is set only where the
        // adapter has an honest signal for it (BL-013); arrived_* mirrors the
        // real columns, so 10.18's Reset restores exactly what arrived (D4).
        status: status ?? null,
        arrivedTitle: title,
        arrivedDescription: null,
        arrivedStatus: status ?? null,
        snapshotFetchedAt: new Date(),
      })

      // One bulk insert, not a create per item (task 15.9b: a big list is thousands of queries one by
      // one). If any of it fails the list just made is removed and the failure reaches the user, so an
      // import never leaves a half-made list behind.
      try {
        await createListItems(
          db,
          user.id,
          list.id,
          candidates.map((candidate) => {
            const known = candidate.timeToConsumeMinutes !== undefined

            return {
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
              source: 'import' as const,
            }
          }),
        )

        // The arrived-state snapshot (D4), written here and refreshed later (Phase 12) — built from the
        // items just created, not re-derived from `candidates`, so it can
        // never drift from what's actually in `list_items`.
        const createdItems = await findListItems(db, user.id, list.id)
        await createListSnapshot(db, list.id, createdItems ?? [])

        await seedGroupOrder(db, list.id)
      } catch (error) {
        await discardList(db, user.id, list.id)
        throw error
      }

      // The list exists now; another add of this source should see upstream
      // as it is then, not this answer.
      expansions.evict(cacheKey)

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
      // The design says an import has no ceiling ("if it parses, it imports").
      // 10 MB is far past any real list and only guards against a wrong file.
      bodyLimit: 10 * 1024 * 1024,
      schema: {
        body: {
          type: 'object',
          required: ['yaml'],
          additionalProperties: false,
          properties: { yaml: { type: 'string', minLength: 1, maxLength: 10 * 1024 * 1024 } },
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
        requireItems(parsed)
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
      const upstreamItems = upstream.items
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

      const newItems = upstreamItems.filter((candidate) => {
        const titleKey = dismissalTitleKey(candidate.title)

        if (candidate.externalRef && knownRefs.has(candidate.externalRef)) return false
        if (knownTitles.has(titleKey)) return false
        if (candidate.externalRef && dismissedRefs.has(candidate.externalRef)) return false

        return !dismissedTitles.has(titleKey)
      })

      return {
        newItems,
        upstreamCount: upstreamItems.length,
        existingCount: existing.length,
        dismissedCount: (await findDismissals(db, user.id, listId)).length,
      }
    },
  )

  /**
   * The UI renders a bucket per category — including ones with no lists yet —
   * so it needs the whole registry, not just the categories in use.
   */
  app.get('/media-types', async () => mediaTypes.list().map(toMediaTypeInfo))

  /**
   * Surprise Me (10.29): the community-library lists you could add and do not
   * have yet. No suggestion engine: the client picks at random from these. An
   * unreachable library is reported as such, never as "nothing left".
   */
  app.get('/library/untracked', async (request) => {
    const user = getCurrentUser(request)

    let manifest
    try {
      manifest = await fetchCanonicalManifest()
    } catch (error) {
      if (error instanceof IngestionError) return { entries: [], reachable: false }
      throw error
    }

    const tracked = new Set(
      (await findLists(db, user.id)).flatMap((list) => (list.externalRef ? [list.externalRef] : [])),
    )

    return {
      entries: untrackedLibraryEntries(manifest, tracked, new Set(mediaTypes.keys())),
      reachable: true,
    }
  })

  /**
   * Bulk-adds items to a list — the single write path for every ingestion
   * route. Manual entry uses it directly today; Phase 3a's adapters will
   * resolve candidates and hand them to the same endpoint.
   *
   * Durations left out are filled from the category's default and marked
   * estimated, which is how `time_to_consume_minutes` stays NOT NULL without
   * the catalog ever inventing a number (SPEC.md §4, §5).
   */
  app.post<{ Params: { listId: string }; Body: { items: ImportItem[]; source?: ItemSource; arrived?: boolean } }>(
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
              // A sanity bound against an accidental huge paste. Typical titles
              // fit 10,000 within Fastify's default 1 MB body limit; very long
              // titles hit that limit first and are refused with a 413.
              maxItems: 10_000,
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
                  tags: { type: 'array', maxItems: MAX_ITEM_TAGS, items: { type: 'string', maxLength: 40 } },
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
            // Set by a refresh's "add what's new": the batch arrived with a
            // sync, so its items carry the NEW marker until Mark all seen.
            arrived: { type: 'boolean' },
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

      // One bulk insert (task 15.9b); it removes what it made if it fails part-way.
      const created =
        (await createListItems(
          db,
          user.id,
          listId,
          request.body.items.map((item) => {
            const known = item.timeToConsumeMinutes !== undefined

            return {
              title: item.title,
              timeToConsumeMinutes: known ? item.timeToConsumeMinutes! : fallbackMinutes,
              timeToConsumeIsEstimated: !known,
              ...(item.externalRef ? { externalRef: item.externalRef } : {}),
              ...(item.year ? { year: item.year } : {}),
              ...(item.group ? { group: item.group } : {}),
              ...(item.tags ? { tags: item.tags } : {}),
              ...(item.notes ? { notes: item.notes } : {}),
              source,
              isNew: request.body.arrived === true,
            }
          }),
        )) ?? []

      // Hand-typed items rarely carry years, so this mostly keeps the order
      // they were typed in; it is here so every import path seeds the same way.
      await seedGroupOrder(db, listId)

      return reply.code(201).send(created)
    },
  )
}
