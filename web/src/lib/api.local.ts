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
  deleteList as repoDeleteList,
  deleteListItem,
  findDismissals,
  findList,
  findListItems,
  findListWithStats,
  findListsWithStats,
  setListItemConsumed,
  updateListItem,
  type ListWithStats,
} from '../../../server/src/catalog/repository.js'
import { dismissalTitleKey, type ListItem as SchemaListItem } from '../../../server/src/db/schema.js'
import { rank, type Suggestion } from '../../../server/src/suggestions/engine.js'
import { copy } from '../locale/index.js'
import type {
  ApiClient,
  CurrentUser,
  ListItem,
  MediaList,
  MediaListDetail,
  MediaType,
  SuggestionPick,
} from './api.js'
import { ApiError } from './api.js'
import { createLocalDb, type LocalDatabase } from './db/localDb.js'
import { getLocalCurrentUser } from './db/localUser.js'
import { getLocalMediaTypes } from './ingestion/localMediaTypes.js'
import { loadLocalStrategy } from './suggestions/localStrategies.js'

function notFound(): ApiError {
  return new ApiError('Not found.', 404)
}

function toMediaList(list: ListWithStats): MediaList {
  return {
    id: list.id,
    title: list.title,
    mediaType: list.mediaType,
    source: list.source,
    externalRef: list.externalRef,
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

  return {
    me: async () => {
      const user = await getLocalCurrentUser(await getDb())
      return { id: user.id, isDefaultLocalUser: user.isDefaultLocalUser } satisfies CurrentUser
    },

    mediaTypes: async () => {
      const entries = await getLocalMediaTypes()
      return [...entries]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(
          (entry): MediaType => ({
            key: entry.key,
            label: entry.label,
            ...(entry.description ? { description: entry.description } : {}),
            sortOrder: entry.sortOrder,
            defaultDurationMinutes: entry.defaultDurationMinutes,
            searchAvailable: entry.adapter?.isAvailable() ?? false,
          }),
        )
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
      const created: ListItem[] = []
      for (const item of items) {
        const known = item.timeToConsumeMinutes !== undefined

        const row = await createListItem(database, userId, listId, {
          title: item.title,
          timeToConsumeMinutes: known ? item.timeToConsumeMinutes! : fallbackMinutes,
          timeToConsumeIsEstimated: !known,
          ...(item.externalRef ? { externalRef: item.externalRef } : {}),
          ...(item.year ? { year: item.year } : {}),
          source,
        })
        created.push(toListItem(row!))
      }

      return created
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

    // Mirrors server/src/ingestion/routes.ts's three handlers, against the
    // real local registry instead of Fastify + a Drizzle db handle.
    searchSources: async (mediaTypeKey, query) => {
      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === mediaTypeKey)
      if (!mediaType) throw notFound()

      const trimmed = query.trim()
      if (!trimmed) throw new ApiError(copy.errors['search.queryRequired'](), 400)

      if (!mediaType.adapter?.isAvailable()) {
        throw new ApiError(copy.errors['search.unavailable']({ category: mediaType.label }), 409)
      }

      return { sources: await mediaType.adapter.search(trimmed) }
    },

    createFromSource: async ({ mediaType: key, externalRef, title }) => {
      const [database, userId] = [await getDb(), await getUserId()]

      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === key)
      if (!mediaType) throw new ApiError(copy.errors['list.unknownCategory']({ key }), 400)

      if (!mediaType.adapter?.isAvailable()) {
        throw new ApiError(copy.errors['search.unavailable']({ category: mediaType.label }), 409)
      }

      // Expanded before the list is created, so a failure upstream does not
      // leave an empty list behind.
      const candidates = await mediaType.adapter.expand(externalRef)
      if (candidates.length === 0) {
        throw new ApiError(copy.errors['list.sourceEmpty']({ title }), 422)
      }

      const list = await repoCreateList(database, userId, {
        title,
        mediaType: key,
        source: 'api',
        externalRef,
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

      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === list.mediaType)
      if (!mediaType?.adapter?.isAvailable()) {
        throw new ApiError(
          copy.errors['refresh.searchUnavailable']({ category: mediaType?.label ?? list.mediaType }),
          409,
        )
      }

      const upstream = await mediaType.adapter.expand(list.externalRef)
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
        dismissedCount: (await findDismissals(database, userId, listId)).length,
      }
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
