import { copy, errorMessage } from '../locale/index.js'
import type {
  GroupRestore,
  ItemRestore,
  ItemSetRestore,
  ListRestore,
  OrderRestore,
} from '../../../server/src/catalog/restorePayloads.js'
import type { FacetConvention } from '../../../server/src/catalog/facets.js'
import type { LibraryEntry } from '../../../server/src/ingestion/customLists.js'
import type { ResetPreview, ResetResult } from '../../../server/src/catalog/reset.js'
import type { SourceOptions } from '../../../server/src/ingestion/sourceRef.js'
import { createLocalApi } from './api.local.js'
/** Types mirror the server's responses; see server/src/catalog and /ingestion. */

export interface ListStats {
  totalItems: number
  consumedItems: number
  /** Arrived with the last refresh and not yet marked seen (10.17). */
  newItems: number
  completionPercent: number
  timeRemainingMinutes: number
  lastConsumedAt: string | null
}

export interface MediaList {
  id: string
  title: string
  /** A longer free-text blurb alongside `title`. Null when not set. */
  description: string | null
  mediaType: string
  source: 'api' | 'llm' | 'manual' | 'file' | 'canonical'
  externalRef: string | null
  /** Production status of the thing the list is about. Null means unknown. */
  status: 'complete' | 'ongoing' | null
  createdAt: string
  updatedAt: string
  stats: ListStats
}

export interface ListItem {
  id: string
  listId: string
  title: string
  orderIndex: number
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated: boolean
  consumedAt: string | null
  /** Typed in by hand, vs. brought in by a search import or a refresh. */
  source: 'manual' | 'import'
  /** Release/publish year, when the source knows one. Null otherwise. */
  year: number | null
  /** Optional grouping label, e.g. "Season 1" — presentation only. Null otherwise. */
  group: string | null
  /** Generic per-item display tags, e.g. ["Album", "Live"]. Null if none. */
  tags: string[] | null
  /** Curator-authored disambiguation prose, capped at 2048 chars. Read-only in the UI. Null if none. */
  notes: string | null
  /** Arrived with the last refresh and not yet marked seen (10.17). */
  isNew: boolean
}

/** A group of a list, as a row of its own (D3, task 10.16): an empty one can exist. */
export interface ListGroup {
  id: string
  listId: string
  name: string
  /** Position among the list's groups, from zero. */
  orderIndex: number
}

export interface MediaListDetail extends MediaList {
  items: ListItem[]
  /** In order, empty groups included. */
  groups: ListGroup[]
}

export interface MediaType {
  key: string
  label: string
  /** What belongs in this category. Not every category needs one. */
  description?: string
  sortOrder: number
  defaultDurationMinutes: number
  searchAvailable: boolean
  /** Whether a preview-before-import can be fetched (same gate as search today). */
  previewable: boolean
  /** The search source's display name ("TMDB"); absent for a by-hand category. */
  sourceName?: string
  /** Which tags mean Type/Medium, Language, Platform here; absent means no facets. */
  facets?: FacetConvention
}

export interface SuggestionPick {
  list: MediaList
  /** The specific thing to consume next; null only if a list is somehow empty. */
  nextItem: ListItem | null
  score: number
  factors: Record<string, number>
}

/** Something upstream that can become a whole list — an artist, a filmography. */
export interface ListSourceResult {
  externalRef: string
  title: string
  detail?: string
  /** A longer free-text blurb — canonical results only, when the source YAML sets one. */
  description?: string
  /** Production status of the thing the list is about — canonical results only, when set. */
  status?: 'complete' | 'ongoing'
}

export interface CurrentUser {
  id: string
  isDefaultLocalUser: boolean
}

export type {
  GroupRestore,
  ItemRestore,
  ItemSetRestore,
  ListRestore,
  OrderRestore,
  ResetPreview,
  ResetResult,
  SourceOptions,
}

export interface SourceSearchResponse {
  sources: ListSourceResult[]
  /** Set only when the community library could not be reached, so curated lists may be missing from `sources`. */
  libraryUnreachable?: boolean
}

export interface SourceExpansion {
  itemCount: number
  /** Only when the source has an honest signal for it. */
  status?: 'complete' | 'ongoing'
}

/** One row of a Preview: what Add list would create, before it does. */
export interface PreviewItem {
  title: string
  externalRef?: string
  timeToConsumeMinutes?: number
  year?: number
  group?: string
  tags?: string[]
  notes?: string
}

export interface SourcePreview extends SourceExpansion {
  items: PreviewItem[]
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's error code (`search.unavailable`, …), when it raised one for the user — lets the UI pick a shape without matching prose. */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Turns a failed response into an `ApiError` to show.
 *
 * Three sources, in order: a code the server raised for the user, whose wording
 * lives in the locale; a `message`, which is what Fastify's own errors carry
 * (schema validation, 404s) and what upstream failures report; then the status
 * on its own.
 */
async function errorFor(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    code?: string
    params?: Record<string, unknown>
    message?: string
  } | null

  const fromCode = body?.code ? errorMessage(body.code, body.params) : undefined

  return new ApiError(
    fromCode ?? body?.message ?? copy.request.failed(response.status),
    response.status,
    ...(fromCode && body?.code ? [body.code] : []),
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    })
  } catch {
    // Distinguish "server isn't running" from "server said no" — during
    // development the first is by far the more common.
    throw new ApiError(copy.request.unreachable, 0)
  }

  if (!response.ok) {
    throw await errorFor(response)
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

/**
 * The one contract every component depends on. Two implementations satisfy
 * it: this file's `fetchApi` (talks to the self-hosted server over HTTP)
 * and `api.local.ts`'s `createLocalApi` (talks to `catalog/repository.ts`
 * directly, no server — docs/DECISIONS.md, "Standalone-app distribution").
 * `index.ts` below picks one per runtime, not per build — see its comment
 * for why that's a deliberate change from the original task plan.
 */
export interface ApiClient {
  me: () => Promise<CurrentUser>
  mediaTypes: () => Promise<MediaType[]>
  lists: () => Promise<MediaList[]>
  list: (id: string) => Promise<MediaListDetail>
  createList: (input: {
    title: string
    mediaType: string
    description?: string | null
    status?: 'complete' | 'ongoing' | null
  }) => Promise<MediaList>
  updateList: (
    id: string,
    patch: { title?: string; description?: string | null; status?: 'complete' | 'ongoing' | null },
  ) => Promise<MediaList>
  /** Acts at once, and hands back everything that went so Undo can restore it (D2). */
  deleteList: (id: string) => Promise<ListRestore>
  /** Undo of `deleteList`: the list comes back with its items, groups, progress and snapshot. */
  restoreList: (restore: ListRestore) => Promise<MediaList>
  importItems: (
    listId: string,
    items: {
      title: string
      externalRef?: string
      timeToConsumeMinutes?: number
      year?: number
      group?: string
      tags?: string[]
      notes?: string
    }[],
    /** Defaults to 'import' — pass 'manual' for a hand-typed batch (task 6.2). */
    source?: 'manual' | 'import',
    /** True for a refresh's "add what's new": the items carry the NEW marker (10.17). */
    arrived?: boolean,
  ) => Promise<ListItem[]>
  /** Mark all seen (10.17): clears the list's NEW markers; says how many it cleared. */
  markSeen: (listId: string) => Promise<{ cleared: number }>
  tiredBoss: (currentListId: string) => Promise<{ picks: SuggestionPick[] }>
  suggest: () => Promise<{ picks: SuggestionPick[] }>
  quickie: () => Promise<{ picks: SuggestionPick[] }>
  finalizer: () => Promise<{ picks: SuggestionPick[] }>
  justOneFix: () => Promise<{ picks: SuggestionPick[] }>
  /** Surprise Me (10.29): the community-library lists you do not track yet; `reachable` is false when the library could not be fetched. */
  libraryUntracked: () => Promise<{ entries: LibraryEntry[]; reachable: boolean }>
  searchSources: (
    mediaType: string,
    query: string,
    /** Book-category-only GUI options — ignored by every other category. */
    options?: { language?: string; includeUnknown?: boolean },
  ) => Promise<SourceSearchResponse>
  /**
   * Expands one search result without creating anything — its item count and,
   * where the source has an honest signal, its status. Takes the same filters
   * an import does, so the count is what Add list would produce.
   */
  expansion: (
    mediaType: string,
    externalRef: string,
    options?: SourceOptions,
  ) => Promise<SourceExpansion>
  /**
   * The same expansion Add list imports, with its items, and without creating
   * anything (task 10.15). One route with `items=true`, not a second one.
   */
  preview: (
    mediaType: string,
    externalRef: string,
    options?: SourceOptions,
  ) => Promise<SourcePreview>
  createFromSource: (input: {
    mediaType: string
    externalRef: string
    title: string
    /** Book-category-only GUI filter (ISO 639-2 code, or omitted/absent for "All"). */
    language?: string
    /** Book-category-only — keep works with no language tag at all. Strict (excluded) by default. */
    includeUnknown?: boolean
    /**
     * Music-category-only discography-type toggles — additive with each
     * other and with the always-included studio albums. EPs and singles on
     * by default, live and compilations off; the route only builds a
     * filtered ref when at least one of these four is actually sent.
     */
    includeEp?: boolean
    includeSingle?: boolean
    includeLive?: boolean
    includeCompilation?: boolean
  }) => Promise<MediaList>
  /** Creates a list from a pasted or uploaded custom-list YAML file (task 7.2). */
  createFromFile: (input: { yaml: string }) => Promise<MediaList>
  checkForUpdates: (
    listId: string,
    includeDismissed?: boolean,
  ) => Promise<{
    newItems: {
      title: string
      externalRef?: string
      timeToConsumeMinutes?: number
      year?: number
      group?: string
      tags?: string[]
      notes?: string
    }[]
    upstreamCount: number
    existingCount: number
    dismissedCount: number
  }>
  deleteItem: (listId: string, itemId: string) => Promise<ItemRestore>
  /** Undo of `deleteItem`: same id, same position index, same done state. */
  restoreItem: (listId: string, restore: ItemRestore) => Promise<ListItem>
  /** Replaces the whole item set — what undoing a Reset posts (task 10.18). */
  restoreItems: (listId: string, set: ItemSetRestore) => Promise<ListItem[]>
  /** Sort chronologically (10.18): one in-place re-sort by year, groups as blocks. Hands back the old order for Undo. */
  sortList: (listId: string) => Promise<{ restore: OrderRestore }>
  /** Undo of `sortList`. */
  restoreOrder: (listId: string, restore: OrderRestore) => Promise<void>
  /** What Reset everything would do, in numbers, without doing it. Refused (409) for a list with no source. */
  resetPreview: (listId: string) => Promise<ResetPreview>
  /** Reset everything: back to the source. Hands back the payload for Undo (`restoreItems`) and whether to run Check for updates next. */
  resetList: (listId: string) => Promise<ResetResult>
  setConsumed: (listId: string, itemId: string, consumed: boolean) => Promise<ListItem>
  addItem: (
    listId: string,
    input: {
      title: string
      timeToConsumeMinutes: number
      timeToConsumeIsEstimated?: boolean
      group?: string | null
    },
  ) => Promise<ListItem>
  updateItem: (
    listId: string,
    itemId: string,
    patch: {
      title?: string
      timeToConsumeMinutes?: number
      timeToConsumeIsEstimated?: boolean
      group?: string | null
    },
  ) => Promise<ListItem>
  /** Renumbers the whole list to this exact id order (task 6.7). */
  reorderItems: (listId: string, itemIds: string[]) => Promise<ListItem[]>
  /** A new, empty group at the end. */
  createGroup: (listId: string, name: string) => Promise<ListGroup>
  /** Renames the group and relabels its items. */
  renameGroup: (listId: string, groupId: string, name: string) => Promise<ListGroup>
  /** Empty groups only. */
  deleteGroup: (listId: string, groupId: string) => Promise<GroupRestore>
  /** Undo of `deleteGroup`: back at its own position. */
  restoreGroup: (listId: string, restore: GroupRestore) => Promise<ListGroup>
  /** The block order; each group's items move with it. Must name every group once. */
  reorderGroups: (listId: string, groupIds: string[]) => Promise<ListGroup[]>
}

function expansionUrl(
  mediaType: string,
  externalRef: string,
  options: SourceOptions,
  withItems = false,
): string {
  const params = new URLSearchParams({ externalRef })
  if (options.language) params.set('language', options.language)
  for (const key of [
    'includeUnknown',
    'includeEp',
    'includeSingle',
    'includeLive',
    'includeCompilation',
  ] as const) {
    const value = options[key]
    if (value !== undefined) params.set(key, String(value))
  }
  if (withItems) params.set('items', 'true')

  return `/media-types/${mediaType}/expansion?${params.toString()}`
}

export const fetchApi: ApiClient = {
  me: () => request<CurrentUser>('/me'),
  mediaTypes: () => request<MediaType[]>('/media-types'),
  lists: () => request<MediaList[]>('/lists'),
  list: (id: string) => request<MediaListDetail>(`/lists/${id}`),

  createList: (input: {
    title: string
    mediaType: string
    description?: string | null
    status?: 'complete' | 'ongoing' | null
  }) => request<MediaList>('/lists', { method: 'POST', body: JSON.stringify(input) }),

  updateList: (
    id: string,
    patch: { title?: string; description?: string | null; status?: 'complete' | 'ongoing' | null },
  ) => request<MediaList>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteList: async (id: string) =>
    (await request<{ restore: ListRestore }>(`/lists/${id}`, { method: 'DELETE' })).restore,

  restoreList: (restore: ListRestore) =>
    request<MediaList>('/lists/restore', { method: 'POST', body: JSON.stringify(restore) }),

  importItems: (
    listId: string,
    items: {
      title: string
      externalRef?: string
      timeToConsumeMinutes?: number
      year?: number
      group?: string
      tags?: string[]
      notes?: string
    }[],
    source?: 'manual' | 'import',
    arrived?: boolean,
  ) =>
    request<ListItem[]>(`/lists/${listId}/items/import`, {
      method: 'POST',
      body: JSON.stringify({
        items,
        ...(source ? { source } : {}),
        ...(arrived ? { arrived } : {}),
      }),
    }),

  markSeen: (listId: string) =>
    request<{ cleared: number }>(`/lists/${listId}/seen`, { method: 'POST' }),

  tiredBoss: (currentListId: string) =>
    request<{ picks: SuggestionPick[] }>('/suggestions/tired-boss', {
      method: 'POST',
      body: JSON.stringify({ currentListId }),
    }),

  suggest: () => request<{ picks: SuggestionPick[] }>('/suggestions/suggest'),

  quickie: () => request<{ picks: SuggestionPick[] }>('/suggestions/quickie'),

  finalizer: () => request<{ picks: SuggestionPick[] }>('/suggestions/finalizer'),

  justOneFix: () => request<{ picks: SuggestionPick[] }>('/suggestions/just-one-fix'),

  libraryUntracked: () => request<{ entries: LibraryEntry[]; reachable: boolean }>('/library/untracked'),

  searchSources: (
    mediaType: string,
    query: string,
    options?: { language?: string; includeUnknown?: boolean },
  ) => {
    const params = new URLSearchParams({ q: query })
    if (options?.language) params.set('language', options.language)
    if (options?.includeUnknown) params.set('includeUnknown', 'true')

    return request<SourceSearchResponse>(`/media-types/${mediaType}/search?${params.toString()}`)
  },

  expansion: (mediaType: string, externalRef: string, options: SourceOptions = {}) =>
    request<SourceExpansion>(expansionUrl(mediaType, externalRef, options)),

  preview: (mediaType: string, externalRef: string, options: SourceOptions = {}) =>
    request<SourcePreview>(expansionUrl(mediaType, externalRef, options, true)),

  createFromSource: (input: {
    mediaType: string
    externalRef: string
    title: string
    language?: string
    includeUnknown?: boolean
    includeEp?: boolean
    includeSingle?: boolean
    includeLive?: boolean
    includeCompilation?: boolean
  }) => request<MediaList>('/lists/from-source', { method: 'POST', body: JSON.stringify(input) }),

  createFromFile: (input: { yaml: string }) =>
    request<MediaList>('/lists/from-file', { method: 'POST', body: JSON.stringify(input) }),

  /** Dry run: reports what the source has that the list does not. Changes nothing. */
  checkForUpdates: (listId: string, includeDismissed = false) =>
    request<{
      newItems: {
        title: string
        externalRef?: string
        timeToConsumeMinutes?: number
        year?: number
        group?: string
        tags?: string[]
        notes?: string
      }[]
      upstreamCount: number
      existingCount: number
      /** How many items were deleted by hand and are being held back. */
      dismissedCount: number
    }>(`/lists/${listId}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ includeDismissed }),
    }),

  deleteItem: async (listId: string, itemId: string) =>
    (
      await request<{ restore: ItemRestore }>(`/lists/${listId}/items/${itemId}`, {
        method: 'DELETE',
      })
    ).restore,

  restoreItem: (listId: string, restore: ItemRestore) =>
    request<ListItem>(`/lists/${listId}/items/restore`, {
      method: 'POST',
      body: JSON.stringify(restore),
    }),

  restoreItems: (listId: string, set: ItemSetRestore) =>
    request<ListItem[]>(`/lists/${listId}/items/restore-all`, {
      method: 'PUT',
      body: JSON.stringify(set),
    }),

  sortList: (listId: string) =>
    request<{ restore: OrderRestore }>(`/lists/${listId}/sort`, { method: 'POST' }),

  restoreOrder: async (listId: string, restore: OrderRestore) => {
    await request<unknown>(`/lists/${listId}/order/restore`, {
      method: 'PUT',
      body: JSON.stringify(restore),
    })
  },

  resetPreview: (listId: string) => request<ResetPreview>(`/lists/${listId}/reset-preview`),

  resetList: (listId: string) => request<ResetResult>(`/lists/${listId}/reset`, { method: 'POST' }),

  setConsumed: (listId: string, itemId: string, consumed: boolean) =>
    request<ListItem>(`/lists/${listId}/items/${itemId}/consumed`, {
      method: 'PUT',
      body: JSON.stringify({ consumed }),
    }),

  addItem: (
    listId: string,
    input: {
      title: string
      timeToConsumeMinutes: number
      timeToConsumeIsEstimated?: boolean
      group?: string | null
    },
  ) => request<ListItem>(`/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(input) }),

  updateItem: (
    listId: string,
    itemId: string,
    patch: {
      title?: string
      timeToConsumeMinutes?: number
      timeToConsumeIsEstimated?: boolean
      group?: string | null
    },
  ) =>
    request<ListItem>(`/lists/${listId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  reorderItems: (listId: string, itemIds: string[]) =>
    request<ListItem[]>(`/lists/${listId}/items/order`, {
      method: 'PUT',
      body: JSON.stringify({ itemIds }),
    }),

  createGroup: (listId: string, name: string) =>
    request<ListGroup>(`/lists/${listId}/groups`, { method: 'POST', body: JSON.stringify({ name }) }),

  renameGroup: (listId: string, groupId: string, name: string) =>
    request<ListGroup>(`/lists/${listId}/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteGroup: async (listId: string, groupId: string) =>
    (await request<{ restore: GroupRestore }>(`/lists/${listId}/groups/${groupId}`, { method: 'DELETE' }))
      .restore,

  restoreGroup: (listId: string, restore: GroupRestore) =>
    request<ListGroup>(`/lists/${listId}/groups/restore`, {
      method: 'POST',
      body: JSON.stringify(restore),
    }),

  reorderGroups: (listId: string, groupIds: string[]) =>
    request<ListGroup[]>(`/lists/${listId}/groups/order`, {
      method: 'PUT',
      body: JSON.stringify({ groupIds }),
    }),
}

/**
 * Runtime selection, not build-time, despite the original task plan's
 * wording (docs/DECISIONS.md, task 5.6). One `web/dist` build already
 * serves both the browser/PWA and the Tauri-wrapped app (task 5.2) — a
 * separate build target for "local" would duplicate that and contradict
 * it. `'__TAURI_INTERNALS__' in window` is the same check already used
 * (and proven) in tasks 5.4 and 5.5's verification.
 */
export const api: ApiClient =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? createLocalApi() : fetchApi
