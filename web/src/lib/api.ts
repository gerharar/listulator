import { copy, errorMessage } from '../locale/index.js'
import { createLocalApi } from './api.local.js'
/** Types mirror the server's responses; see server/src/catalog and /ingestion. */

export interface ListStats {
  totalItems: number
  consumedItems: number
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
}

export interface MediaListDetail extends MediaList {
  items: ListItem[]
}

export interface MediaType {
  key: string
  label: string
  /** What belongs in this category. Not every category needs one. */
  description?: string
  sortOrder: number
  defaultDurationMinutes: number
  searchAvailable: boolean
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Turns a failed response into something to show.
 *
 * Three sources, in order: a code the server raised for the user, whose wording
 * lives in the locale; a `message`, which is what Fastify's own errors carry
 * (schema validation, 404s) and what upstream failures report; then the status
 * on its own.
 */
async function messageFor(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    code?: string
    params?: Record<string, unknown>
    message?: string
  } | null

  const fromCode = body?.code ? errorMessage(body.code, body.params) : undefined

  return fromCode ?? body?.message ?? copy.request.failed(response.status)
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
    throw new ApiError(await messageFor(response), response.status)
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
  deleteList: (id: string) => Promise<void>
  importItems: (
    listId: string,
    items: {
      title: string
      externalRef?: string
      timeToConsumeMinutes?: number
      year?: number
      group?: string
      tags?: string[]
    }[],
    /** Defaults to 'import' — pass 'manual' for a hand-typed batch (task 6.2). */
    source?: 'manual' | 'import',
  ) => Promise<ListItem[]>
  tiredBoss: (currentListId: string) => Promise<{ picks: SuggestionPick[] }>
  suggest: () => Promise<{ picks: SuggestionPick[] }>
  quickie: () => Promise<{ picks: SuggestionPick[] }>
  searchSources: (
    mediaType: string,
    query: string,
    /** Book-category-only GUI options — ignored by every other category. */
    options?: { language?: string; includeUnknown?: boolean },
  ) => Promise<{ sources: ListSourceResult[] }>
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
    }[]
    upstreamCount: number
    existingCount: number
    dismissedCount: number
  }>
  deleteItem: (listId: string, itemId: string) => Promise<void>
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
  /**
   * "This list was updated" check (task 7.6) — canonical-synced lists only,
   * on-trigger (app open or an explicit "sync now"), never background
   * polling.
   */
  checkSyncedListUpdates: () => Promise<{ updates: { listId: string; title: string }[] }>
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

  deleteList: (id: string) => request<void>(`/lists/${id}`, { method: 'DELETE' }),

  importItems: (
    listId: string,
    items: {
      title: string
      externalRef?: string
      timeToConsumeMinutes?: number
      year?: number
      group?: string
      tags?: string[]
    }[],
    source?: 'manual' | 'import',
  ) =>
    request<ListItem[]>(`/lists/${listId}/items/import`, {
      method: 'POST',
      body: JSON.stringify({ items, ...(source ? { source } : {}) }),
    }),

  tiredBoss: (currentListId: string) =>
    request<{ picks: SuggestionPick[] }>('/suggestions/tired-boss', {
      method: 'POST',
      body: JSON.stringify({ currentListId }),
    }),

  suggest: () => request<{ picks: SuggestionPick[] }>('/suggestions/suggest'),

  quickie: () => request<{ picks: SuggestionPick[] }>('/suggestions/quickie'),

  searchSources: (
    mediaType: string,
    query: string,
    options?: { language?: string; includeUnknown?: boolean },
  ) => {
    const params = new URLSearchParams({ q: query })
    if (options?.language) params.set('language', options.language)
    if (options?.includeUnknown) params.set('includeUnknown', 'true')

    return request<{ sources: ListSourceResult[] }>(
      `/media-types/${mediaType}/search?${params.toString()}`,
    )
  },

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
      }[]
      upstreamCount: number
      existingCount: number
      /** How many items were deleted by hand and are being held back. */
      dismissedCount: number
    }>(`/lists/${listId}/refresh`, {
      method: 'POST',
      body: JSON.stringify({ includeDismissed }),
    }),

  deleteItem: (listId: string, itemId: string) =>
    request<void>(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),

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

  checkSyncedListUpdates: () =>
    request<{ updates: { listId: string; title: string }[] }>('/lists/updates'),
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
