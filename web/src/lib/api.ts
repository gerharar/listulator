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
  mediaType: string
  source: 'api' | 'llm' | 'manual'
  externalRef: string | null
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
}

export interface MediaListDetail extends MediaList {
  items: ListItem[]
}

export interface MediaType {
  key: string
  label: string
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
    throw new ApiError('Cannot reach the server. Is it running?', 0)
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new ApiError(body?.message ?? `Request failed (${response.status})`, response.status)
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export const api = {
  me: () => request<CurrentUser>('/me'),
  mediaTypes: () => request<MediaType[]>('/media-types'),
  lists: () => request<MediaList[]>('/lists'),
  list: (id: string) => request<MediaListDetail>(`/lists/${id}`),

  createList: (input: { title: string; mediaType: string }) =>
    request<MediaList>('/lists', { method: 'POST', body: JSON.stringify(input) }),

  deleteList: (id: string) => request<void>(`/lists/${id}`, { method: 'DELETE' }),

  importItems: (listId: string, items: { title: string }[]) =>
    request<ListItem[]>(`/lists/${listId}/items/import`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  tiredBoss: (currentListId: string) =>
    request<{ picks: SuggestionPick[] }>('/suggestions/tired-boss', {
      method: 'POST',
      body: JSON.stringify({ currentListId }),
    }),

  suggest: () => request<{ picks: SuggestionPick[] }>('/suggestions/suggest'),

  quickie: () => request<{ picks: SuggestionPick[] }>('/suggestions/quickie'),

  deleteItem: (listId: string, itemId: string) =>
    request<void>(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),

  setConsumed: (listId: string, itemId: string, consumed: boolean) =>
    request<ListItem>(`/lists/${listId}/items/${itemId}/consumed`, {
      method: 'PUT',
      body: JSON.stringify({ consumed }),
    }),
}
