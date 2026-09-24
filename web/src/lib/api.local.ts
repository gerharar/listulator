// Local implementation of `ApiClient` (api.ts) — no server, no fetch.
// Calls `catalog/repository.ts` directly against the standalone app's own
// SQLite (web/src/lib/db/localDb.ts), per docs/DECISIONS.md's
// "Standalone-app distribution" architecture.
//
// Ingestion (searchSources, createFromSource, checkForUpdates) mirrors
// server/src/ingestion/routes.ts against `getLocalMediaTypes()` — the real
// registry, credentialed from Tauri's store plugin rather than `.env`
// (task 5.7). Suggestions (tiredBoss, suggest, quickie) mirror
// server/src/suggestions/routes.ts against `loadLocalStrategy()` — the
// bundled-asset counterpart to `STRATEGIES_DIR` (task 5.8); `engine.ts`'s
// `rank` itself is unchanged and unforked.
import {
  clearDismissals,
  createList as repoCreateList,
  createListItem,
  createListSnapshot,
  deleteList as repoDeleteList,
  deleteListItem,
  findDismissals,
  findList,
  findListItems,
  findLists,
  findListWithStats,
  findListsWithStats,
  reorderListItems,
  ReorderMismatchError,
  setListItemConsumed,
  updateList as repoUpdateList,
  updateListItem,
  type ListWithStats,
} from '../../../server/src/catalog/repository.js'
import {
  dismissalTitleKey,
  type List as SchemaList,
  type ListItem as SchemaListItem,
} from '../../../server/src/db/schema.js'
import {
  canonicalPathFromExternalRef,
  CustomListParseError,
  expandCanonicalList,
  fetchCanonicalList,
  isSafeCanonicalPath,
  parseCustomList,
  searchCanonicalLists,
} from '../../../server/src/ingestion/customLists.js'
import { rank, type Suggestion } from '../../../server/src/suggestions/engine.js'
import { copy, errorMessage } from '../locale/index.js'
import type {
  ApiClient,
  CurrentUser,
  ListItem,
  MediaList,
  MediaListDetail,
  SuggestionPick,
} from './api.js'
import { ApiError } from './api.js'
import { createLocalDb, type LocalDatabase } from './db/localDb.js'
import { getLocalCurrentUser } from './db/localUser.js'
import { toMediaTypeInfo } from '../../../server/src/ingestion/mediaTypes.js'
import { getLocalMediaTypes } from './ingestion/localMediaTypes.js'
import { loadLocalStrategy } from './suggestions/localStrategies.js'

function notFound(): ApiError {
  return new ApiError('Not found.', 404)
}

function toMediaList(list: ListWithStats): MediaList {
  return {
    id: list.id,
    title: list.title,
    description: list.description,
    mediaType: list.mediaType,
    source: list.source,
    externalRef: list.externalRef,
    status: list.status,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    stats: {
      totalItems: list.stats.totalItems,
      consumedItems: list.stats.consumedItems,
      completionPercent: list.stats.completionPercent,
      timeRemainingMinutes: list.stats.timeRemainingMinutes,
      lastConsumedAt: list.stats.lastConsumedAt?.toISOString() ?? null,
    },
  }
}

function toListItem(item: SchemaListItem): ListItem {
  return {
    id: item.id,
    listId: item.listId,
    title: item.title,
    orderIndex: item.orderIndex,
    timeToConsumeMinutes: item.timeToConsumeMinutes,
    timeToConsumeIsEstimated: item.timeToConsumeIsEstimated,
    consumedAt: item.consumedAt?.toISOString() ?? null,
    source: item.source,
    year: item.year,
    group: item.group,
    tags: item.tags,
    notes: item.notes,
  }
}

function toSuggestionPick(suggestion: Suggestion): SuggestionPick {
  return {
    list: toMediaList(suggestion.list),
    nextItem: suggestion.nextItem ? toListItem(suggestion.nextItem) : null,
    score: suggestion.score,
    factors: suggestion.factors,
  }
}

/** Mirrors server/src/suggestions/routes.ts's own inline `suggest()`. */
async function localSuggest(
  database: LocalDatabase,
  userId: string,
  strategyName: string,
  currentListId?: string,
): Promise<Suggestion[]> {
  const strategy = loadLocalStrategy(strategyName)
  const candidates = await findListsWithStats(database, userId)

  // Only the lists that survive filtering need their items loaded. Order
  // doesn't matter for building this map, so these run concurrently.
  const nextItems = new Map<string, SchemaListItem | undefined>(
    await Promise.all(
      candidates.map(
        async (list) =>
          [
            list.id,
            (await findListItems(database, userId, list.id))?.find(
              (item) => item.consumedAt === null,
            ),
          ] as const,
      ),
    ),
  )

  return rank({
    strategy,
    candidates,
    nextItems,
    ...(currentListId ? { currentListId } : {}),
  })
}

export function createLocalApi(): ApiClient {
  let db: LocalDatabase | undefined

  async function getDb(): Promise<LocalDatabase> {
    db ??= await createLocalDb()
    return db
  }

  async function getUserId(): Promise<string> {
    const user = await getLocalCurrentUser(await getDb())
    return user.id
  }

  // Mirrors server/src/ingestion/routes.ts's hasCanonicalUpdate (task 7.6) —
  // same title-only new-item matching, dismissals excluded, silently
  // degrading on a fetch/parse failure since this runs automatically rather
  // than against one list an explicit action chose.
  async function hasCanonicalUpdate(
    database: LocalDatabase,
    userId: string,
    list: SchemaList,
  ): Promise<boolean> {
    const canonicalPath = canonicalPathFromExternalRef(list.externalRef)
    if (!canonicalPath || !isSafeCanonicalPath(canonicalPath)) return false

    const mediaTypes = await getLocalMediaTypes()

    let upstream
    try {
      upstream = await expandCanonicalList(
        canonicalPath,
        new Set(mediaTypes.map((entry) => entry.key)),
      )
    } catch {
      return false
    }

    const existing = (await findListItems(database, userId, list.id)) ?? []
    const knownTitles = new Set(existing.map((item) => dismissalTitleKey(item.title)))

    const dismissed = await findDismissals(database, userId, list.id)
    const dismissedTitles = new Set(dismissed.map((item) => item.titleKey))

    return upstream.items.some((candidate) => {
      const titleKey = dismissalTitleKey(candidate.title)
      return !knownTitles.has(titleKey) && !dismissedTitles.has(titleKey)
    })
  }

  return {
    me: async () => {
      const user = await getLocalCurrentUser(await getDb())
      return { id: user.id, isDefaultLocalUser: user.isDefaultLocalUser } satisfies CurrentUser
    },

    mediaTypes: async () => {
      const entries = await getLocalMediaTypes()
      return [...entries].sort((a, b) => a.sortOrder - b.sortOrder).map(toMediaTypeInfo)
    },

    lists: async () => {
      const [database, userId] = [await getDb(), await getUserId()]
      return (await findListsWithStats(database, userId)).map(toMediaList)
    },

    list: async (id) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findListWithStats(database, userId, id)
      if (!list) throw notFound()

      const items = (await findListItems(database, userId, id)) ?? []
      return { ...toMediaList(list), items: items.map(toListItem) } satisfies MediaListDetail
    },

    createList: async (input) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const created = await repoCreateList(database, userId, input)
      const withStats = await findListWithStats(database, userId, created.id)
      return toMediaList(withStats!)
    },

    updateList: async (id, patch) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const updated = await repoUpdateList(database, userId, id, patch)
      if (!updated) throw notFound()
      const withStats = await findListWithStats(database, userId, updated.id)
      return toMediaList(withStats!)
    },

    deleteList: async (id) => {
      const [database, userId] = [await getDb(), await getUserId()]
      if (!(await repoDeleteList(database, userId, id))) throw notFound()
    },

    importItems: async (listId, items, source = 'import') => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findList(database, userId, listId)
      if (!list) throw notFound()

      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === list.mediaType)
      const fallbackMinutes = mediaType?.defaultDurationMinutes ?? 30

      // Changing your mind about a deletion — the record that you once
      // deleted it has to go with it (matches ingestion/routes.ts).
      await clearDismissals(database, listId, items)

      // Sequential, not Promise.all — see docs/DECISIONS.md, task 5.1.
      const created: SchemaListItem[] = []
      for (const item of items) {
        const known = item.timeToConsumeMinutes !== undefined

        const row = await createListItem(database, userId, listId, {
          title: item.title,
          timeToConsumeMinutes: known ? item.timeToConsumeMinutes! : fallbackMinutes,
          timeToConsumeIsEstimated: !known,
          ...(item.externalRef ? { externalRef: item.externalRef } : {}),
          ...(item.year ? { year: item.year } : {}),
          ...(item.group ? { group: item.group } : {}),
          ...(item.tags ? { tags: item.tags } : {}),
          ...(item.notes ? { notes: item.notes } : {}),
          source,
        })
        created.push(row!)
      }

      return created.map(toListItem)
    },

    deleteItem: async (listId, itemId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      if (!(await deleteListItem(database, userId, listId, itemId))) throw notFound()
    },

    setConsumed: async (listId, itemId, consumed) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const updated = await setListItemConsumed(database, userId, listId, itemId, consumed)
      if (!updated) throw notFound()
      return toListItem(updated)
    },

    addItem: async (listId, input) => {
      const [database, userId] = [await getDb(), await getUserId()]
      // This method's whole reason to exist is adding one item by hand
      // (task 6.1/6.2) — bulk/search-imported items always go through
      // importItems/createFromSource instead.
      const item = await createListItem(database, userId, listId, { ...input, source: 'manual' })
      if (!item) throw notFound()
      return toListItem(item)
    },

    updateItem: async (listId, itemId, patch) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const updated = await updateListItem(database, userId, listId, itemId, patch)
      if (!updated) throw notFound()
      return toListItem(updated)
    },

    reorderItems: async (listId, itemIds) => {
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const reordered = await reorderListItems(database, userId, listId, itemIds)
        if (!reordered) throw notFound()
        return reordered.map(toListItem)
      } catch (cause) {
        if (cause instanceof ReorderMismatchError) throw new ApiError(cause.message, 400)
        throw cause
      }
    },

    // Mirrors server/src/ingestion/routes.ts's three handlers, against the
    // real local registry instead of Fastify + a Drizzle db handle.
    //
    // Both also merge in canonical-repo matches (task 7.4) — searching within
    // a category matches canonical list titles in that category too, the
    // actual confirmed intent (not a separate browse UI). `raw.githubusercontent.com`
    // sends `access-control-allow-origin: *` (verified directly), so the
    // webview's own `fetch` reaches it — no Tauri HTTP-plugin routing needed,
    // unlike IGDB/Comic Vine/MusicBrainz (task 5.7).
    searchSources: async (mediaTypeKey, query, options) => {
      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === mediaTypeKey)
      if (!mediaType) throw notFound()

      const trimmed = query.trim()
      if (!trimmed) throw new ApiError(copy.errors['search.queryRequired'](), 400)

      const canonicalMatches = await searchCanonicalLists(mediaTypeKey, trimmed)

      if (!mediaType.adapter?.isAvailable()) {
        if (canonicalMatches.length === 0) {
          throw new ApiError(copy.errors['search.unavailable']({ category: mediaType.label }), 409)
        }
        return { sources: canonicalMatches }
      }

      return {
        sources: [...canonicalMatches, ...(await mediaType.adapter.search(trimmed, options))],
      }
    },

    createFromSource: async ({
      mediaType: key,
      externalRef,
      title,
      language,
      includeUnknown,
      includeEp,
      includeSingle,
      includeLive,
      includeCompilation,
    }) => {
      const [database, userId] = [await getDb(), await getUserId()]

      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === key)
      if (!mediaType) throw new ApiError(copy.errors['list.unknownCategory']({ key }), 400)

      // A canonical-repo search result — reuses 7.2's parser/import path
      // entirely, same as server/src/ingestion/routes.ts's /lists/from-source.
      const canonicalPath = canonicalPathFromExternalRef(externalRef)
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) {
          throw new ApiError(errorMessage('list.fileInvalid') ?? 'list.fileInvalid', 400)
        }

        const mediaTypes = await getLocalMediaTypes()

        let parsed
        try {
          parsed = await fetchCanonicalList(
            canonicalPath,
            new Set(mediaTypes.map((entry) => entry.key)),
          )
        } catch (cause) {
          if (cause instanceof CustomListParseError) {
            throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400)
          }
          throw cause
        }

        const parsedMediaType = mediaTypes.find((entry) => entry.key === parsed.category)!

        const list = await repoCreateList(database, userId, {
          title: parsed.title,
          description: parsed.description ?? null,
          mediaType: parsed.category,
          source: 'canonical',
          externalRef,
          status: parsed.status ?? null,
        })

        // Sequential, not Promise.all — see docs/DECISIONS.md, task 5.1.
        for (const item of parsed.items) {
          const known = item.minutes !== undefined

          await createListItem(database, userId, list.id, {
            title: item.title,
            timeToConsumeMinutes: known ? item.minutes! : parsedMediaType.defaultDurationMinutes,
            timeToConsumeIsEstimated: !known,
            ...(item.year !== undefined ? { year: item.year } : {}),
            ...(item.group !== undefined ? { group: item.group } : {}),
            ...(item.tags !== undefined ? { tags: item.tags } : {}),
            ...(item.notes !== undefined ? { notes: item.notes } : {}),
            source: 'import',
          })
        }

        const withStats = await findListWithStats(database, userId, list.id)
        return toMediaList(withStats!)
      }

      if (!mediaType.adapter?.isAvailable()) {
        throw new ApiError(copy.errors['search.unavailable']({ category: mediaType.label }), 409)
      }

      // Mirrors server/src/ingestion/routes.ts's /lists/from-source — the
      // language filter (and its "include unknown" flag) become part of
      // the stored ref, so checkForUpdates (this file's mirror of
      // /lists/:listId/refresh) replays the same filter later with no
      // changes of its own. The music discography-type toggles follow the
      // same technique, gated on whether the GUI actually sent them.
      const musicFacets =
        includeEp !== undefined ||
        includeSingle !== undefined ||
        includeLive !== undefined ||
        includeCompilation !== undefined
          ? [
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
      const { items: candidates } = await mediaType.adapter.expand(refForAdapter)
      if (candidates.length === 0) {
        throw new ApiError(copy.errors['list.sourceEmpty']({ title }), 422)
      }

      const list = await repoCreateList(database, userId, {
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

      // Sequential, not Promise.all — see docs/DECISIONS.md, task 5.1.
      for (const candidate of candidates) {
        const known = candidate.timeToConsumeMinutes !== undefined

        await createListItem(database, userId, list.id, {
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
      // never drift from what's actually in list_items.
      const createdItems = await findListItems(database, userId, list.id)
      await createListSnapshot(database, list.id, createdItems ?? [])

      const withStats = await findListWithStats(database, userId, list.id)
      return toMediaList(withStats!)
    },

    // Mirrors server/src/ingestion/routes.ts's /lists/from-file handler,
    // against the real local registry instead of Fastify + a Drizzle db
    // handle — same parser, same validation, same error codes.
    createFromFile: async ({ yaml }) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const mediaTypes = await getLocalMediaTypes()

      let parsed
      try {
        parsed = parseCustomList(yaml, new Set(mediaTypes.map((entry) => entry.key)))
      } catch (cause) {
        if (cause instanceof CustomListParseError) {
          throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400)
        }
        throw cause
      }

      const mediaType = mediaTypes.find((entry) => entry.key === parsed.category)!

      const list = await repoCreateList(database, userId, {
        title: parsed.title,
        description: parsed.description ?? null,
        mediaType: parsed.category,
        source: 'file',
        status: parsed.status ?? null,
        sourceYaml: yaml,
      })

      // Sequential, not Promise.all — see docs/DECISIONS.md, task 5.1.
      for (const item of parsed.items) {
        const known = item.minutes !== undefined

        await createListItem(database, userId, list.id, {
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

      const withStats = await findListWithStats(database, userId, list.id)
      return toMediaList(withStats!)
    },

    checkForUpdates: async (listId, includeDismissed = false) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findList(database, userId, listId)
      if (!list) throw notFound()

      if (!list.externalRef) {
        throw new ApiError(copy.errors['refresh.handMadeList'](), 409)
      }

      // Mirrors server/src/ingestion/routes.ts's /lists/:listId/refresh — a
      // synced canonical list (task 7.4) refetches and reparses the file
      // directly instead of going through mediaType.adapter.expand(), which
      // was never built to understand a `canonical:<path>` ref.
      const canonicalPath = canonicalPathFromExternalRef(list.externalRef)

      let upstream
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) {
          throw new ApiError(errorMessage('list.fileInvalid') ?? 'list.fileInvalid', 400)
        }

        const localMediaTypes = await getLocalMediaTypes()
        try {
          upstream = await expandCanonicalList(
            canonicalPath,
            new Set(localMediaTypes.map((entry) => entry.key)),
          )
        } catch (cause) {
          if (cause instanceof CustomListParseError) {
            throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400)
          }
          throw cause
        }
      } else {
        const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === list.mediaType)
        if (!mediaType?.adapter?.isAvailable()) {
          throw new ApiError(
            copy.errors['refresh.searchUnavailable']({
              category: mediaType?.label ?? list.mediaType,
            }),
            409,
          )
        }

        upstream = await mediaType.adapter.expand(list.externalRef)
      }
      const upstreamItems = upstream.items
      const existing = (await findListItems(database, userId, listId)) ?? []

      // Matched on the upstream id where there is one, and on title otherwise:
      // Wikipedia events and Open Library works carry no stable id.
      const knownRefs = new Set(existing.map((item) => item.externalRef).filter(Boolean))
      const knownTitles = new Set(existing.map((item) => dismissalTitleKey(item.title)))

      // Things deleted by hand, which a refresh must not keep offering back —
      // otherwise pruning an import never sticks. Ticking the box ignores
      // them, which is both the undo for an accidental delete and the way
      // out if a shared title over-suppressed something.
      const dismissed = includeDismissed ? [] : await findDismissals(database, userId, listId)
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
        dismissedCount: (await findDismissals(database, userId, listId)).length,
      }
    },

    // Mirrors server/src/ingestion/routes.ts's GET /lists/updates (task
    // 7.6) — scoped to canonical-synced lists only, same reasoning as
    // there: checking every real adapter's API on every app open would
    // reintroduce the per-key rate-limit pressure canonical lists exist to
    // avoid.
    checkSyncedListUpdates: async () => {
      const [database, userId] = [await getDb(), await getUserId()]

      const synced = (await findLists(database, userId)).filter((list) =>
        canonicalPathFromExternalRef(list.externalRef),
      )

      const updates = []
      for (const list of synced) {
        if (await hasCanonicalUpdate(database, userId, list)) {
          updates.push({ listId: list.id, title: list.title })
        }
      }

      return { updates }
    },

    tiredBoss: async (currentListId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const suggestions = await localSuggest(database, userId, 'tired-boss', currentListId)
      return { picks: suggestions.map(toSuggestionPick) }
    },

    suggest: async () => {
      const [database, userId] = [await getDb(), await getUserId()]
      const suggestions = await localSuggest(database, userId, 'suggest')
      return { picks: suggestions.map(toSuggestionPick) }
    },

    quickie: async () => {
      const [database, userId] = [await getDb(), await getUserId()]
      const suggestions = await localSuggest(database, userId, 'quickie')
      return { picks: suggestions.map(toSuggestionPick) }
    },
  }
}
