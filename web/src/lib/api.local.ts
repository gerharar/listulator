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
  findListWithStats,
  findListsWithStats,
  markListSeen,
  reorderListItems,
  ReorderMismatchError,
  setListItemConsumed,
  updateList as repoUpdateList,
  updateListItem,
  type ListWithStats,
  type RuntimeStatsOptions,
} from '../../../server/src/catalog/repository.js'
import { createListItems, discardList, itemFromFile, itemFromSource } from '../../../server/src/catalog/bulkItems.js'
import { MAX_LIST_ITEMS } from '../../../server/src/catalog/limits.js'
import { knownRuntimes, withKnownRuntimes, withRuntimePending } from '../../../server/src/catalog/runtimes.js'
import {
  createRuntimeFiller,
  enrichPrefixesByMediaType,
  type RuntimeFiller,
} from '../../../server/src/catalog/runtimeFill.js'
import {
  dismissalTitleKey,
  type ListGroup as SchemaListGroup,
  type ListItem as SchemaListItem,
} from '../../../server/src/db/schema.js'
import {
  canonicalPathFromExternalRef,
  CustomListParseError,
  expandCanonicalList,
  fetchCanonicalList,
  isSafeCanonicalPath,
  parseCustomList,
  requireItems,
  fetchCanonicalManifest,
  untrackedLibraryEntries,
} from '../../../server/src/ingestion/customLists.js'
import { IngestionError } from '../../../server/src/ingestion/http.js'
import {
  maintainSourceCopies,
  startSourceCopySchedule,
} from '../../../server/src/catalog/sourceCopySchedule.js'
import {
  previewReset,
  resetOrderToSource,
  sourceTagsOf,
  resetToSource,
  ResetSourceEmptyError,
  ResetUnavailableError,
  sortChronologically,
  type ResetDeps,
} from '../../../server/src/catalog/reset.js'
import { restoreOrder } from '../../../server/src/catalog/restore.js'
import { rank, type Suggestion } from '../../../server/src/suggestions/engine.js'
import { loadRankingInputs } from '../../../server/src/suggestions/rankingInputs.js'
import { copy, errorMessage } from '../locale/index.js'
import type {
  ApiClient,
  CurrentUser,
  ListGroup,
  ListItem,
  MediaList,
  MediaListDetail,
  SourceOptions,
  SuggestionPick,
} from './api.js'
import { ApiError } from './api.js'
import { checkNameLengths } from './nameLimit.js'
import { createLocalDb, type LocalDatabase } from './db/localDb.js'
import { getLocalCurrentUser } from './db/localUser.js'
import { toMediaTypeInfo, type MediaType } from '../../../server/src/ingestion/mediaTypes.js'
import { searchSources, SearchUnavailableError } from '../../../server/src/ingestion/search.js'
import { refForAdapter } from '../../../server/src/ingestion/sourceRef.js'
import {
  ListExistsError,
  restoreItemSet,
  restoreList,
  restoreListGroup,
  restoreListItem,
} from '../../../server/src/catalog/restore.js'
import {
  createListGroup,
  deleteListGroup,
  findListGroups,
  GroupNameError,
  GroupNotEmptyError,
  GroupReorderMismatchError,
  renameListGroup,
  reorderListGroups,
  seedGroupOrder,
} from '../../../server/src/catalog/groups.js'
import {
  createExpansionCache,
  expansionCacheKey,
  type ExpansionCache,
} from '../../../server/src/ingestion/expansionCache.js'
import {
  countSource,
  expandSource,
  listingOptions,
  ListTooLargeError,
  SourceUnavailableError,
  UnsafeSourceError,
} from '../../../server/src/ingestion/expandSource.js'
import { getLocalMediaTypes, LOCAL_FETCHERS } from './ingestion/localMediaTypes.js'
import { testKey, type KeySource, type KeyTestResult } from './config/keyTest.js'
import type { LocalSettings } from './config/localConfig.js'
import { loadLocalStrategy } from './suggestions/localStrategies.js'

function notFound(): ApiError {
  return new ApiError('Not found.', 404)
}

function toMediaList(list: ListWithStats): MediaList {
  return {
    canReset: list.canReset !== false,
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
      newItems: list.stats.newItems,
      completionPercent: list.stats.completionPercent,
      timeRemainingMinutes: list.stats.timeRemainingMinutes,
      lastConsumedAt: list.stats.lastConsumedAt?.toISOString() ?? null,
      runtimesPending: list.stats.runtimesPending ?? 0,
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
    isNew: item.isNew,
  }
}

/** A Reset's refusals as the server words them (mirrors catalog/routes.ts's `resetError`); anything else passes through. */
function resetError(cause: unknown): unknown {
  if (cause instanceof ResetUnavailableError) {
    return new ApiError(errorMessage('reset.unavailable') ?? 'reset.unavailable', 409, 'reset.unavailable')
  }
  if (cause instanceof SourceUnavailableError) {
    const params = { category: cause.category }
    return new ApiError(errorMessage('refresh.searchUnavailable', params) ?? 'refresh.searchUnavailable', 409, 'refresh.searchUnavailable')
  }
  if (cause instanceof ResetSourceEmptyError) {
    const params = { title: cause.title }
    return new ApiError(errorMessage('list.sourceEmpty', params) ?? 'list.sourceEmpty', 422, 'list.sourceEmpty')
  }
  if (cause instanceof ListTooLargeError) {
    return tooLarge({ ...(cause.title ? { title: cause.title } : {}), count: cause.count, max: cause.max })
  }
  if (cause instanceof CustomListParseError) {
    return new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400, cause.code)
  }

  return cause
}

/**
 * The live registry, as the shared Reset code wants it: valid categories, default runtimes and, for a list
 * with no stored copy, the adapters to fetch its source through (sharing one fetch through `expansions`).
 */
async function resetDeps(expansions: ExpansionCache): Promise<ResetDeps> {
  return { mediaTypes: await getLocalMediaTypes(), expansions }
}

/** A source above the ceiling on a list (15.9): the API's own error, 422, with the numbers and, on Add list, the source. */
function tooLarge(params: { title?: string; count: number; max: number }): ApiError {
  return new ApiError(copy.errors['list.sourceTooLarge'](params), 422, 'list.sourceTooLarge')
}

/** The API's own refusals for the group repository's errors (mirrors catalog/routes.ts). */
function groupError(cause: unknown): unknown {
  const refuse = (status: number, code: 'group.nameEmpty' | 'group.nameTaken' | 'group.notEmpty' | 'group.orderMismatch') =>
    new ApiError(errorMessage(code) ?? code, status, code)

  if (cause instanceof GroupNameError) {
    return cause.reason === 'empty' ? refuse(400, 'group.nameEmpty') : refuse(409, 'group.nameTaken')
  }
  if (cause instanceof GroupNotEmptyError) return refuse(409, 'group.notEmpty')
  if (cause instanceof GroupReorderMismatchError) return refuse(400, 'group.orderMismatch')

  return cause
}

function toListGroup(group: SchemaListGroup): ListGroup {
  return { id: group.id, listId: group.listId, name: group.name, orderIndex: group.orderIndex }
}

function toSuggestionPick(suggestion: Suggestion): SuggestionPick {
  return {
    list: toMediaList(suggestion.list),
    nextItem: suggestion.nextItem ? toListItem(suggestion.nextItem) : null,
    score: suggestion.score,
    factors: suggestion.factors,
  }
}

/** Mirrors server/src/suggestions/routes.ts's own inline `suggest()`; both load through `loadRankingInputs`. */
async function localSuggest(
  database: LocalDatabase,
  userId: string,
  strategyName: string,
  currentListId?: string,
): Promise<Suggestion[]> {
  const strategy = loadLocalStrategy(strategyName)

  return rank({
    strategy,
    ...(await loadRankingInputs(database, userId)),
    ...(currentListId ? { currentListId } : {}),
  })
}

/**
 * The Settings "Test" button (task 10.31) — desktop only, so it lives here and
 * not on `ApiClient`: the server keeps its keys in the environment and has no
 * such call. Sends the key as typed to its own provider and returns one word.
 */
export function testApiKey(source: KeySource, values: LocalSettings): Promise<KeyTestResult> {
  return testKey(source, values, LOCAL_FETCHERS)
}

let stopSourceCopyCheck: (() => void) | undefined

/**
 * Looks after the stored source copies of fetched lists for as long as the desktop app is open (task
 * 12.4): at launch, then every day. The same shared pass the server runs, against the local database
 * and the registry with the Tauri-routed fetches. Safe to call more than once.
 */
export function startLocalSourceCopySchedule(): void {
  if (stopSourceCopyCheck) return

  stopSourceCopyCheck = startSourceCopySchedule(
    async () => {
      const [db, mediaTypes] = await Promise.all([createLocalDb(), getLocalMediaTypes()])
      const summary = await maintainSourceCopies(db, { mediaTypes })
      if (summary.checked > 0) console.info('source copies checked:', summary)
    },
    { onError: (error) => console.error('source copy check failed:', error) },
  )
}

// A hot reload re-runs this module: stop the old timer so two do not run side by side.
import.meta.hot?.dispose(() => {
  stopSourceCopyCheck?.()
  stopSourceCopyCheck = undefined
  stopRuntimeFill.abort()
})

/** Stops the lookup of lengths when the app closes (or this module is reloaded): nothing outlives it. */
const stopRuntimeFill = new AbortController()
let runtimeFiller: Promise<RuntimeFiller> | undefined
let launchFill: Promise<void> | undefined

/**
 * The one runner that looks up the lengths of items a list was built without (task 15.6; the server's is
 * `app.runtimeFiller`, 15.5): the local database, the registry as it is when a run starts (Settings
 * rebuilds it when a key is saved), stopped when the window goes. Its requests are paced where they are
 * sent (TMDB's client, 15.9).
 */
export function getLocalRuntimeFiller(): Promise<RuntimeFiller> {
  runtimeFiller ??= createLocalDb().then((db) => {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => stopRuntimeFill.abort(), { once: true })

    return createRuntimeFiller({
      db,
      mediaTypes: () => getLocalMediaTypes(),
      signal: stopRuntimeFill.signal,
    })
  })

  return runtimeFiller
}

/**
 * At launch, picks up every list whose lengths were not all looked up when the app was last open: the
 * pending state is in the database, so this resumes whatever was cut off. Resolves when that is done;
 * safe to call more than once (the second call is the first run).
 */
export function startLocalRuntimeFill(): Promise<void> {
  launchFill ??= getLocalRuntimeFiller()
    .then((filler) => filler.fillAll())
    .then((summary) => {
      if (summary.lists > 0) console.info('lengths looked up for lists:', summary.lists)
    })
    .catch((error: unknown) => console.error('looking up lengths failed:', error))

  return launchFill
}

/** Looks up a list's missing lengths in the background: not awaited, and never a reason to fail the call. */
function startRuntimeFill(listId: string): void {
  getLocalRuntimeFiller()
    .then((filler) => filler.fill(listId))
    .catch((error: unknown) => console.error('looking up lengths failed:', error))
}

/** What the list stats need to count the lengths still to look up: the registry as it is now. */
async function runtimeStats(): Promise<RuntimeStatsOptions> {
  return { prefixesByMediaType: enrichPrefixesByMediaType(await getLocalMediaTypes()) }
}

export function createLocalApi(): ApiClient {
  let db: LocalDatabase | undefined
  // The desktop app's process is the cache's lifetime — see expansionCache.ts.
  const expansions = createExpansionCache()

  async function getDb(): Promise<LocalDatabase> {
    db ??= await createLocalDb()
    return db
  }

  async function getUserId(): Promise<string> {
    const user = await getLocalCurrentUser(await getDb())
    return user.id
  }

  /** What `expansion` and `preview` share: run something on a source, in the API's own errors. */
  async function forSource<T>(
    mediaTypeKey: string,
    run: (mediaType: MediaType, validCategories: ReadonlySet<string>) => Promise<T>,
  ): Promise<T> {
    const mediaTypes = await getLocalMediaTypes()
    const mediaType = mediaTypes.find((entry) => entry.key === mediaTypeKey)
    if (!mediaType) throw notFound()

    try {
      return await run(mediaType, new Set(mediaTypes.map((entry) => entry.key)))
    } catch (cause) {
      if (cause instanceof SourceUnavailableError) {
        throw new ApiError(
          copy.errors['search.unavailable']({ category: mediaType.label }),
          409,
          'search.unavailable',
        )
      }
      if (cause instanceof ListTooLargeError) {
        throw tooLarge({ count: cause.count, max: cause.max })
      }
      if (cause instanceof UnsafeSourceError) {
        throw new ApiError(
          errorMessage('list.fileInvalid') ?? 'list.fileInvalid',
          400,
          'list.fileInvalid',
        )
      }
      if (cause instanceof CustomListParseError) {
        throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400, cause.code)
      }
      throw cause
    }
  }

  const expandForApi = (mediaTypeKey: string, externalRef: string, options: SourceOptions) =>
    forSource(mediaTypeKey, (mediaType, validCategories) =>
      expandSource(mediaType, externalRef, options, validCategories, expansions),
    )

  /** The number alone, by the adapter's cheap count where it has one (a YouTube channel); undefined: list it. */
  const countForApi = (mediaTypeKey: string, externalRef: string, options: SourceOptions) =>
    forSource(mediaTypeKey, (mediaType) => countSource(mediaType, externalRef, options))

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
      return (await findListsWithStats(database, userId, await runtimeStats())).map(toMediaList)
    },

    list: async (id) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findListWithStats(database, userId, id, await runtimeStats())
      if (!list) throw notFound()

      // Each item says whether its length is still being looked up, so the screen can show "-" (15.7).
      const items = await withRuntimePending(
        database,
        id,
        (await findListItems(database, userId, id)) ?? [],
        new Date(),
        enrichPrefixesByMediaType(await getLocalMediaTypes()).get(list.mediaType),
      )
      const groups = (await findListGroups(database, userId, id)) ?? []
      const detail = {
        ...toMediaList(list),
        items: items.map((item) => ({ ...toListItem(item), runtimePending: item.runtimePending })),
        groups: groups.map(toListGroup),
      } satisfies MediaListDetail

      // Opening a list tops up its lengths, in the background, started after the read so the answer shows
      // what the count in it counted (mirrors catalog/routes.ts, 15.5).
      if ((list.stats.runtimesPending ?? 0) > 0) startRuntimeFill(list.id)

      return detail
    },

    createList: async (input) => {
      checkNameLengths({ title: input.title })
      const [database, userId] = [await getDb(), await getUserId()]
      const created = await repoCreateList(database, userId, input)
      const withStats = await findListWithStats(database, userId, created.id, await runtimeStats())
      return toMediaList(withStats!)
    },

    updateList: async (id, patch) => {
      checkNameLengths({ title: patch.title })
      const [database, userId] = [await getDb(), await getUserId()]
      const updated = await repoUpdateList(database, userId, id, patch)
      if (!updated) throw notFound()
      const withStats = await findListWithStats(database, userId, updated.id, await runtimeStats())
      return toMediaList(withStats!)
    },

    deleteList: async (id) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const restore = await repoDeleteList(database, userId, id)
      if (!restore) throw notFound()
      return restore
    },

    restoreList: async (restore) => {
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        await restoreList(database, userId, restore)
      } catch (cause) {
        if (cause instanceof ListExistsError) {
          throw new ApiError(errorMessage('list.alreadyExists') ?? 'list.alreadyExists', 409, 'list.alreadyExists')
        }
        throw cause
      }

      const withStats = await findListWithStats(database, userId, restore.list.id, await runtimeStats())
      return toMediaList(withStats!)
    },

    importItems: async (listId, items, source = 'import', arrived = false) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findList(database, userId, listId)
      if (!list) throw notFound()

      const mediaType = (await getLocalMediaTypes()).find((entry) => entry.key === list.mediaType)
      const fallbackMinutes = mediaType?.defaultDurationMinutes ?? 30

      // Changing your mind about a deletion — the record that you once
      // deleted it has to go with it (matches ingestion/routes.ts).
      await clearDismissals(database, listId, items)

      // What a check found carries no length for a source whose lengths are looked up afterwards (15.10): a
      // film some list has already looked up gets it here, the rest the estimate and then the runner.
      const withKnownLengths = withKnownRuntimes(
        items,
        await knownRuntimes(
          database,
          items.filter((item) => item.externalRef && item.timeToConsumeMinutes === undefined).map((item) => item.externalRef!),
          new Date(),
        ),
      )

      // One bulk insert (task 15.9b); it removes what it made if it fails part-way.
      const created: SchemaListItem[] =
        (await createListItems(
          database,
          userId,
          listId,
          withKnownLengths.map((item) => ({ ...itemFromSource(item, item.timeToConsumeMinutes, fallbackMinutes), source, isNew: arrived })),
        )) ?? []
      await seedGroupOrder(database, listId)

      // Whatever is still without a length is looked up in the background.
      if (enrichPrefixesByMediaType(await getLocalMediaTypes()).has(list.mediaType)) startRuntimeFill(listId)

      return created.map(toListItem)
    },

    markSeen: async (listId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const cleared = await markListSeen(database, userId, listId)
      if (cleared === undefined) throw notFound()
      return { cleared }
    },

    deleteItem: async (listId, itemId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const restore = await deleteListItem(database, userId, listId, itemId)
      if (!restore) throw notFound()
      return restore
    },

    restoreItem: async (listId, restore) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const item = await restoreListItem(database, userId, listId, restore)
      if (!item) throw notFound()
      return toListItem(item)
    },

    restoreItems: async (listId, set) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const items = await restoreItemSet(database, userId, listId, set)
      if (!items) throw notFound()
      return items.sort((a, b) => a.orderIndex - b.orderIndex).map(toListItem)
    },

    sortList: async (listId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const restore = await sortChronologically(database, userId, listId)
      if (!restore) throw notFound()
      return { restore }
    },

    resetOrder: async (listId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      try {
        const restore = await resetOrderToSource(database, userId, listId, await resetDeps(expansions))
        if (!restore) throw notFound()
        return { restore }
      } catch (cause) {
        throw resetError(cause)
      }
    },

    itemSource: async (listId, itemId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      try {
        const source = await sourceTagsOf(database, userId, listId, itemId, await resetDeps(expansions))
        if (!source) throw notFound()
        return source
      } catch (cause) {
        throw resetError(cause)
      }
    },

    restoreOrder: async (listId, restore) => {
      const [database, userId] = [await getDb(), await getUserId()]
      if (!(await restoreOrder(database, userId, listId, restore))) throw notFound()
    },

    resetPreview: async (listId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      try {
        const preview = await previewReset(database, userId, listId, await resetDeps(expansions))
        if (!preview) throw notFound()
        return preview
      } catch (cause) {
        throw resetError(cause)
      }
    },

    resetList: async (listId) => {
      const [database, userId] = [await getDb(), await getUserId()]
      try {
        const result = await resetToSource(database, userId, listId, await resetDeps(expansions))
        if (!result) throw notFound()

        // The list is rebuilt from its source: whatever still has no length is looked up after (15.11).
        const reset = await findList(database, userId, listId)
        if (reset && enrichPrefixesByMediaType(await getLocalMediaTypes()).has(reset.mediaType)) startRuntimeFill(listId)

        return result
      } catch (cause) {
        throw resetError(cause)
      }
    },

    setConsumed: async (listId, itemId, consumed) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const updated = await setListItemConsumed(database, userId, listId, itemId, consumed)
      if (!updated) throw notFound()
      return toListItem(updated)
    },

    addItem: async (listId, input) => {
      checkNameLengths({ title: input.title, group: input.group })
      const [database, userId] = [await getDb(), await getUserId()]
      // This method's whole reason to exist is adding one item by hand
      // (task 6.1/6.2) — bulk/search-imported items always go through
      // importItems/createFromSource instead.
      const item = await createListItem(database, userId, listId, { ...input, source: 'manual' })
      if (!item) throw notFound()
      return toListItem(item)
    },

    updateItem: async (listId, itemId, patch) => {
      checkNameLengths({ title: patch.title, group: patch.group })
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

    // Groups (D3, task 10.16) — the same repository the server's routes call.
    createGroup: async (listId, name) => {
      checkNameLengths({ name })
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const group = await createListGroup(database, userId, listId, name)
        if (!group) throw notFound()
        return toListGroup(group)
      } catch (cause) {
        throw groupError(cause)
      }
    },

    renameGroup: async (listId, groupId, name) => {
      checkNameLengths({ name })
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const group = await renameListGroup(database, userId, listId, groupId, name)
        if (!group) throw notFound()
        return toListGroup(group)
      } catch (cause) {
        throw groupError(cause)
      }
    },

    deleteGroup: async (listId, groupId, options = {}) => {
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const restore = await deleteListGroup(database, userId, listId, groupId, options)
        if (!restore) throw notFound()
        return restore
      } catch (cause) {
        throw groupError(cause)
      }
    },

    restoreGroup: async (listId, restore) => {
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const group = await restoreListGroup(database, userId, listId, restore)
        if (!group) throw notFound()
        return toListGroup(group)
      } catch (cause) {
        throw groupError(cause)
      }
    },

    reorderGroups: async (listId, groupIds) => {
      const [database, userId] = [await getDb(), await getUserId()]

      try {
        const groups = await reorderListGroups(database, userId, listId, groupIds)
        if (!groups) throw notFound()
        return groups.map(toListGroup)
      } catch (cause) {
        throw groupError(cause)
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
      if (!trimmed) throw new ApiError(copy.errors['search.queryRequired'](), 400, 'search.queryRequired')

      try {
        return await searchSources(mediaType, trimmed, options ?? {})
      } catch (cause) {
        // Mirrors server/src/ingestion/routes.ts through the same shared function.
        if (cause instanceof SearchUnavailableError) {
          throw new ApiError(copy.errors[cause.code]({ category: mediaType.label }), 409, cause.code)
        }
        throw cause
      }
    },

    expansion: async (mediaTypeKey, externalRef, options = {}) => {
      const counted = await countForApi(mediaTypeKey, externalRef, options)
      if (counted !== undefined) return { itemCount: counted }

      const { items, status } = await expandForApi(mediaTypeKey, externalRef, options)

      return { itemCount: items.length, ...(status ? { status } : {}) }
    },

    preview: async (mediaTypeKey, externalRef, options = {}) => {
      const { items, status } = await expandForApi(mediaTypeKey, externalRef, options)

      return { itemCount: items.length, ...(status ? { status } : {}), items }
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
      if (!mediaType) throw new ApiError(copy.errors['list.unknownCategory']({ key }), 400, 'list.unknownCategory')

      // A canonical-repo search result — reuses 7.2's parser/import path
      // entirely, same as server/src/ingestion/routes.ts's /lists/from-source.
      const canonicalPath = canonicalPathFromExternalRef(externalRef)
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) {
          throw new ApiError(errorMessage('list.fileInvalid') ?? 'list.fileInvalid', 400, 'list.fileInvalid')
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
            throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400, cause.code)
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

        // One bulk insert, and a failure removes the list just made (mirrors ingestion/routes.ts, 15.9b).
        try {
          await createListItems(
            database,
            userId,
            list.id,
            parsed.items.map((item) => itemFromFile(item, parsedMediaType.defaultDurationMinutes)),
          )
          await seedGroupOrder(database, list.id)
        } catch (error) {
          await discardList(database, userId, list.id)
          throw error
        }

        const withStats = await findListWithStats(database, userId, list.id, await runtimeStats())
        return toMediaList(withStats!)
      }

      if (!mediaType.adapter?.isAvailable()) {
        throw new ApiError(copy.errors['search.unavailable']({ category: mediaType.label }), 409, 'search.unavailable')
      }

      // Mirrors server/src/ingestion/routes.ts's /lists/from-source: the filters
      // become part of the stored ref (see `refForAdapter`).
      const adapterRef = refForAdapter(externalRef, {
        ...(language !== undefined ? { language } : {}),
        ...(includeUnknown !== undefined ? { includeUnknown } : {}),
        ...(includeEp !== undefined ? { includeEp } : {}),
        ...(includeSingle !== undefined ? { includeSingle } : {}),
        ...(includeLive !== undefined ? { includeLive } : {}),
        ...(includeCompilation !== undefined ? { includeCompilation } : {}),
      })

      // Expanded before the list is created, so a failure upstream does not
      // leave an empty list behind. A source that can look lengths up afterwards is listed without them
      // and its list made at once (mirrors ingestion/routes.ts, 15.5).
      const adapter = mediaType.adapter
      const expandOptions = listingOptions(adapter)
      const lookedUpLater = expandOptions !== undefined
      const cacheKey = expansionCacheKey(key, adapterRef, expandOptions)
      const { items: listed, status } = await expansions.get(cacheKey, () =>
        expandOptions ? adapter.expand(adapterRef, expandOptions) : adapter.expand(adapterRef),
      )
      const candidates = lookedUpLater
        ? withKnownRuntimes(
            listed,
            await knownRuntimes(
              database,
              listed.filter((item) => item.externalRef && item.timeToConsumeMinutes === undefined).map((item) => item.externalRef!),
              new Date(),
            ),
          )
        : listed
      if (candidates.length === 0) {
        throw new ApiError(copy.errors['list.sourceEmpty']({ title }), 422, 'list.sourceEmpty')
      }
      if (candidates.length > MAX_LIST_ITEMS) throw tooLarge({ title, count: candidates.length, max: MAX_LIST_ITEMS })

      const list = await repoCreateList(database, userId, {
        title,
        mediaType: key,
        source: 'api',
        externalRef: adapterRef,
        // Mirrors server/src/ingestion/routes.ts: status only where the
        // adapter has an honest signal (BL-013); arrived_* mirrors it (D4).
        status: status ?? null,
        arrivedTitle: title,
        arrivedDescription: null,
        arrivedStatus: status ?? null,
        snapshotFetchedAt: new Date(),
      })

      // One bulk insert, and a failure removes the list just made, so an import never leaves a
      // half-made list (mirrors ingestion/routes.ts, 15.9b).
      try {
        await createListItems(
          database,
          userId,
          list.id,
          candidates.map((candidate) => itemFromSource(candidate, candidate.timeToConsumeMinutes, mediaType.defaultDurationMinutes)),
        )

        // The arrived-state snapshot (D4), written here and refreshed later (Phase 12) — built from the
        // items just created, not re-derived from `candidates`, so it can
        // never drift from what's actually in list_items.
        const createdItems = await findListItems(database, userId, list.id)
        await createListSnapshot(database, list.id, createdItems ?? [])
        await seedGroupOrder(database, list.id)
      } catch (error) {
        await discardList(database, userId, list.id)
        throw error
      }

      // The list exists now; another add of this source should see upstream then.
      expansions.evict(cacheKey)

      // The lengths are looked up after the reply: not awaited.
      const withStats = await findListWithStats(database, userId, list.id, await runtimeStats())
      if (lookedUpLater) startRuntimeFill(list.id)

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
        requireItems(parsed)
      } catch (cause) {
        if (cause instanceof CustomListParseError) {
          throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400, cause.code)
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

      // One bulk insert, and a failure removes the list just made (mirrors ingestion/routes.ts, 15.9b).
      try {
        await createListItems(
          database,
          userId,
          list.id,
          parsed.items.map((item) => itemFromFile(item, mediaType.defaultDurationMinutes)),
        )
        await seedGroupOrder(database, list.id)
      } catch (error) {
        await discardList(database, userId, list.id)
        throw error
      }

      const withStats = await findListWithStats(database, userId, list.id, await runtimeStats())
      return toMediaList(withStats!)
    },

    checkForUpdates: async (listId, includeDismissed = false) => {
      const [database, userId] = [await getDb(), await getUserId()]
      const list = await findList(database, userId, listId)
      if (!list) throw notFound()

      if (!list.externalRef) {
        throw new ApiError(copy.errors['refresh.handMadeList'](), 409, 'refresh.handMadeList')
      }

      // Mirrors server/src/ingestion/routes.ts's /lists/:listId/refresh — a
      // synced canonical list (task 7.4) refetches and reparses the file
      // directly instead of going through mediaType.adapter.expand(), which
      // was never built to understand a `canonical:<path>` ref.
      const canonicalPath = canonicalPathFromExternalRef(list.externalRef)

      let upstream
      if (canonicalPath) {
        if (!isSafeCanonicalPath(canonicalPath)) {
          throw new ApiError(errorMessage('list.fileInvalid') ?? 'list.fileInvalid', 400, 'list.fileInvalid')
        }

        const localMediaTypes = await getLocalMediaTypes()
        try {
          upstream = await expandCanonicalList(
            canonicalPath,
            new Set(localMediaTypes.map((entry) => entry.key)),
          )
        } catch (cause) {
          if (cause instanceof CustomListParseError) {
            throw new ApiError(errorMessage(cause.code, cause.params) ?? cause.code, 400, cause.code)
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

        // Listed without lengths when the source can look them up afterwards (15.10, mirrors
        // ingestion/routes.ts): finding what is new costs a listing, not a request for every film. Never
        // through the cache: a check exists to see upstream as it is now.
        const adapter = mediaType.adapter
        const listingMode = listingOptions(adapter)
        upstream = await (listingMode ? adapter.expand(list.externalRef, listingMode) : adapter.expand(list.externalRef))

        // A source that has grown past what a list holds is refused, as on Add list.
        if (upstream.items.length > MAX_LIST_ITEMS) {
          throw tooLarge({ title: list.title, count: upstream.items.length, max: MAX_LIST_ITEMS })
        }
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

    justOneFix: async () => {
      const [database, userId] = [await getDb(), await getUserId()]
      const suggestions = await localSuggest(database, userId, 'just-one-fix')
      return { picks: suggestions.map(toSuggestionPick) }
    },

    libraryUntracked: async () => {
      // Mirrors server/src/ingestion/routes.ts's GET /library/untracked.
      let manifest
      try {
        manifest = await fetchCanonicalManifest()
      } catch (error) {
        if (error instanceof IngestionError) return { entries: [], reachable: false }
        throw error
      }

      const [database, userId] = [await getDb(), await getUserId()]
      const tracked = new Set(
        (await findListsWithStats(database, userId)).flatMap((list) => (list.externalRef ? [list.externalRef] : [])),
      )
      const known = new Set((await getLocalMediaTypes()).map((entry) => entry.key))

      return { entries: untrackedLibraryEntries(manifest, tracked, known), reachable: true }
    },

    finalizer: async () => {
      const [database, userId] = [await getDb(), await getUserId()]
      const suggestions = await localSuggest(database, userId, 'finalizer')
      return { picks: suggestions.map(toSuggestionPick) }
    },
  }
}
