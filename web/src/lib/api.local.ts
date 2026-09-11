// Local implementation of `ApiClient` (api.ts) — no server, no fetch.
// Calls `catalog/repository.ts` directly against the standalone app's own
// SQLite (web/src/lib/db/localDb.ts), per docs/DECISIONS.md's
// "Standalone-app distribution" architecture.
//
// Scope for this task (5.6): everything catalog/routes.ts backs — me,
// mediaTypes, lists, list, createList, deleteList, importItems, deleteItem,
// setConsumed. Ingestion (searchSources, createFromSource,
// checkForUpdates — task 5.7) and suggestions (tiredBoss, suggest, quickie
// — task 5.8) are real, typed stubs: they throw rather than being silently
// missing, so a click surfaces a clear message instead of `undefined is
// not a function`.
import {
  clearDismissals,
  createList as repoCreateList,
  createListItem,
  deleteList as repoDeleteList,
  deleteListItem,
  findList,
  findListItems,
  findListWithStats,
  findListsWithStats,
  setListItemConsumed,
  type ListWithStats,
} from '../../../server/src/catalog/repository.js'
import { DEFAULT_MEDIA_TYPES } from '../../../server/src/ingestion/mediaTypes.js'
import type { ListItem as SchemaListItem } from '../../../server/src/db/schema.js'
import type {
  ApiClient,
  CurrentUser,
  ListItem,
  MediaList,
  MediaListDetail,
  MediaType,
} from './api.js'
import { ApiError } from './api.js'
import { createLocalDb, type LocalDatabase } from './db/localDb.js'
import { getLocalCurrentUser } from './db/localUser.js'

/**
 * Metadata only — deliberately not `createMediaTypeRegistry(DEFAULT_MEDIA_TYPES)`.
 * Each entry's `adapter` is built from `process.env`-backed credentials
 * (server/src/ingestion/mediaTypes.ts), which doesn't exist in a webview,
 * and calling any adapter method would throw. Reading `key`/`label`/
 * `sortOrder`/`defaultDurationMinutes` off the array never touches
 * `.adapter`, so this is safe — importing the module doesn't evaluate any
 * credential lookup either, only calling an adapter method would. Task 5.7
 * replaces `searchAvailable: false` below with the real thing.
 */
const mediaTypesByKey = new Map(DEFAULT_MEDIA_TYPES.map((entry) => [entry.key, entry]))

function notFound(): ApiError {
  return new ApiError('Not found.', 404)
}

function notImplemented(what: string): ApiError {
  return new ApiError(`${what} isn't available in the standalone app yet.`, 501)
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
  }
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

    mediaTypes: async () =>
      [...mediaTypesByKey.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(
          (entry): MediaType => ({
            key: entry.key,
            label: entry.label,
            ...(entry.description ? { description: entry.description } : {}),
            sortOrder: entry.sortOrder,
            defaultDurationMinutes: entry.defaultDurationMinutes,
            searchAvailable: false,
          }),
        ),

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

    importItems: async (listId, items) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findList(database, userId, listId)
      if (!list) throw notFound()

      const fallbackMinutes = mediaTypesByKey.get(list.mediaType)?.defaultDurationMinutes ?? 30

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

    // Task 5.7.
    searchSources: async () => {
      throw notImplemented('Search')
    },
    createFromSource: async () => {
      throw notImplemented('Building a list from a source')
    },
    checkForUpdates: async () => {
      throw notImplemented('Checking for updates')
    },

    // Task 5.8.
    tiredBoss: async () => {
      throw notImplemented('Suggestions')
    },
    suggest: async () => {
      throw notImplemented('Suggestions')
    },
    quickie: async () => {
      throw notImplemented('Suggestions')
    },
  }
}
