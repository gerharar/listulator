import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api.js'

function respondWith(body: unknown, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('turning a failed response into something to show', () => {
  it('words a server error code from the locale', async () => {
    // The whole point of the code contract: the server names the situation,
    // the sentence is written once, here.
    respondWith({ code: 'search.unavailable', params: { category: 'Movies' } }, 409)

    await expect(api.lists()).rejects.toThrow('Search is not available for Movies. You can import a list or create one manually')
  })

  it('falls back to a message for errors that carry one', async () => {
    // Fastify writes its own for schema violations and 404s, and upstream
    // failures report which service said what — neither is app copy.
    respondWith({ message: 'TMDB is rate-limiting us. Try again shortly.' }, 502)

    await expect(api.lists()).rejects.toThrow('TMDB is rate-limiting us. Try again shortly.')
  })

  it('falls back again for a code it does not recognise', async () => {
    // A newer server against an older web. Degrades to the status rather than
    // showing a raw code or throwing.
    respondWith({ code: 'invented.later' }, 418)

    await expect(api.lists()).rejects.toThrow('Request failed (418)')
  })

  it('prefers the code over a message when both are present', async () => {
    respondWith({ code: 'refresh.handMadeList', message: 'stale prose' }, 409)

    await expect(api.lists()).rejects.toThrow(
      'This list was a hand job, so there is nothing to check against',
    )
  })

  it('says the server is unreachable rather than blaming the request', async () => {
    // During development this is by far the more common failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(api.lists()).rejects.toThrow('Cannot reach the server. Is anybody there?')
  })

  it('carries the status for callers that need it', async () => {
    respondWith({ code: 'search.queryRequired' }, 400)

    await expect(api.lists()).rejects.toMatchObject({ status: 400, name: 'ApiError' })
    expect(new ApiError('x', 400)).toBeInstanceOf(Error)
  })

  it("keeps the server's error code, so the UI can pick a shape without matching prose", async () => {
    respondWith({ code: 'search.unavailable', params: { category: 'Movies' } }, 409)

    await expect(api.lists()).rejects.toMatchObject({ code: 'search.unavailable', status: 409 })
  })

  it('has no code for an error that carried only a message', async () => {
    respondWith({ message: 'TMDB is rate-limiting us.' }, 502)

    const error = await api.lists().catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBeUndefined()
  })

  it('marks an unreachable server as status 0, distinct from a server that said no', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(api.lists()).rejects.toMatchObject({ status: 0 })
  })
})

describe('expanding a search result without creating it', () => {
  function stubFetch(body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('asks the expansion route for the items too when previewing', async () => {
    respondWith({ itemCount: 1, items: [{ title: 'A' }] }, 200)

    const result = await api.preview('music', 'artist-1', { includeEp: true })

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      '/api/media-types/music/expansion?externalRef=artist-1&includeEp=true&items=true',
    )
    expect(result.items).toEqual([{ title: 'A' }])
  })

  it('asks the expansion route for the ref and returns count and status', async () => {
    const fetchMock = stubFetch({ itemCount: 12, status: 'ongoing' })

    const result = await api.expansion('tv', 'show:1396')

    expect(result).toEqual({ itemCount: 12, status: 'ongoing' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/media-types/tv/expansion?externalRef=show%3A1396',
      expect.anything(),
    )
  })

  it("sends the same filters an import would, so the count is the import's count", async () => {
    const fetchMock = stubFetch({ itemCount: 3 })

    await api.expansion('book', 'author:OL1A', { language: 'eng', includeUnknown: true })
    await api.expansion('music', 'artist-1', {
      includeEp: true,
      includeSingle: false,
      includeLive: true,
      includeCompilation: false,
    })

    const urls = fetchMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(urls[0]).toBe(
      '/api/media-types/book/expansion?externalRef=author%3AOL1A&language=eng&includeUnknown=true',
    )
    expect(urls[1]).toBe(
      '/api/media-types/music/expansion?externalRef=artist-1&includeEp=true&includeSingle=false&includeLive=true&includeCompilation=false',
    )
  })
})

function stubbedMediaList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'list-1',
    title: 'Star Wars: Main Saga',
    description: null,
    mediaType: 'movie',
    source: 'manual',
    externalRef: null,
    status: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {
      totalItems: 0,
      consumedItems: 0,
      completionPercent: 0,
      timeRemainingMinutes: 0,
      lastConsumedAt: null,
    },
    ...overrides,
  }
}

describe('creating and updating a list', () => {
  it('createList sends description and status when given them', async () => {
    respondWith(stubbedMediaList({ description: 'The saga', status: 'ongoing' }), 201)

    await api.createList({
      title: 'Star Wars: Main Saga',
      mediaType: 'movie',
      description: 'The saga',
      status: 'ongoing',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toMatchObject({
      description: 'The saga',
      status: 'ongoing',
    })
  })

  it('createList response carries description and status through', async () => {
    respondWith(stubbedMediaList({ description: 'The saga', status: 'ongoing' }), 201)

    const created = await api.createList({ title: 'Star Wars: Main Saga', mediaType: 'movie' })

    expect(created.description).toBe('The saga')
    expect(created.status).toBe('ongoing')
  })

  it('updateList PATCHes only the given fields to /lists/:id', async () => {
    respondWith(stubbedMediaList({ description: 'The saga', status: 'ongoing' }), 200)

    await api.updateList('list-1', { description: 'The saga', status: 'ongoing' })

    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('/api/lists/list-1')
    expect(init!.method).toBe('PATCH')
    expect(JSON.parse(init!.body as string)).toEqual({ description: 'The saga', status: 'ongoing' })
  })

  it('updateList response carries description and status through', async () => {
    respondWith(stubbedMediaList({ description: 'The saga', status: 'ongoing' }), 200)

    const updated = await api.updateList('list-1', { description: 'The saga', status: 'ongoing' })

    expect(updated.description).toBe('The saga')
    expect(updated.status).toBe('ongoing')
  })
})

describe('group calls (task 10.16)', () => {
  function stubFetch(body: unknown = {}, status = 200) {
    const fetchMock = vi.fn(
      async () => new Response(status === 204 ? null : JSON.stringify(body), { status }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('creates a group', async () => {
    const fetchMock = stubFetch({ id: 'g1', name: 'Season 1' })

    expect(await api.createGroup('L1', 'Season 1')).toEqual({ id: 'g1', name: 'Season 1' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/groups',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Season 1' }) }),
    )
  })

  it('renames a group', async () => {
    const fetchMock = stubFetch({ id: 'g1', name: 'New' })

    await api.renameGroup('L1', 'g1', 'New')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/groups/g1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'New' }) }),
    )
  })

  it('deletes a group, and gets back what Undo needs', async () => {
    const restore = { group: { id: 'g1', name: 'Old', orderIndex: 0 } }
    const fetchMock = stubFetch({ restore })

    expect(await api.deleteGroup('L1', 'g1')).toEqual(restore)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/groups/g1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('reorders the groups', async () => {
    const fetchMock = stubFetch([{ id: 'g2' }, { id: 'g1' }])

    await api.reorderGroups('L1', ['g2', 'g1'])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/groups/order',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ groupIds: ['g2', 'g1'] }) }),
    )
  })

  it('words the group refusals from the locale', async () => {
    stubFetch({ code: 'group.nameTaken' }, 409)
    await expect(api.createGroup('L1', 'x')).rejects.toThrow('already has a group with such name')

    stubFetch({ code: 'group.notEmpty' }, 409)
    await expect(api.deleteGroup('L1', 'g1')).rejects.toThrow('only when you embrace its emptiness')
  })
})

describe('undo calls (task 10.19a)', () => {
  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('an item delete hands back the restore payload, and restoreItem posts it back', async () => {
    const restore = { item: { id: 'i1', title: 'A' }, dismissalId: 'd1' }
    let fetchMock = stubFetch({ restore })

    expect(await api.deleteItem('L1', 'i1')).toEqual(restore)
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1/items/i1', expect.objectContaining({ method: 'DELETE' }))

    fetchMock = stubFetch({ id: 'i1' })
    await api.restoreItem('L1', restore as never)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/items/restore',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(restore) }),
    )
  })

  it('importItems tells the server a batch arrived with a refresh', async () => {
    const fetchMock = stubFetch([])

    await api.importItems('L1', [{ title: 'A' }], 'import', true)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/items/import',
      expect.objectContaining({
        body: JSON.stringify({ items: [{ title: 'A' }], source: 'import', arrived: true }),
      }),
    )
  })

  it('importItems says nothing about arrival for an ordinary import', async () => {
    const fetchMock = stubFetch([])

    await api.importItems('L1', [{ title: 'A' }])

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/items/import',
      expect.objectContaining({ body: JSON.stringify({ items: [{ title: 'A' }] }) }),
    )
  })

  it('markSeen posts to the list and returns how many markers it cleared', async () => {
    const fetchMock = stubFetch({ cleared: 3 })

    expect(await api.markSeen('L1')).toEqual({ cleared: 3 })
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1/seen', expect.objectContaining({ method: 'POST' }))
  })

  it('sortList posts to the list and hands back what Undo needs; restoreOrder posts it back', async () => {
    const restore = { items: [{ id: 'i1', orderIndex: 2 }], groups: [{ id: 'g1', orderIndex: 0 }] }
    let fetchMock = stubFetch({ restore })

    expect(await api.sortList('L1')).toEqual({ restore })
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1/sort', expect.objectContaining({ method: 'POST' }))

    fetchMock = stubFetch({ restored: true })
    await api.restoreOrder('L1', restore)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/order/restore',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(restore) }),
    )
  })

  it('resetPreview reads what a Reset would do; resetList does it and returns the payload for Undo', async () => {
    const preview = { removed: 2, restored: 1, doneCleared: 3, followUpCheck: true }
    let fetchMock = stubFetch(preview)

    expect(await api.resetPreview('L1')).toEqual(preview)
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1/reset-preview', expect.anything())

    const result = { counts: { removed: 2, restored: 1, doneCleared: 3 }, followUpCheck: true, restore: { items: [], dismissals: [] } }
    fetchMock = stubFetch(result)
    expect(await api.resetList('L1')).toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1/reset', expect.objectContaining({ method: 'POST' }))
  })

  it('says a hand-made list cannot be reset, in words', async () => {
    stubFetch({ code: 'reset.unavailable' }, 409)

    await expect(api.resetList('L1')).rejects.toThrow(/nothing to reset|no source/i)
  })

  it('a group is restored by posting its payload back', async () => {
    const restore = { group: { id: 'g1', name: 'A', orderIndex: 0 } }
    const fetchMock = stubFetch({ id: 'g1' })

    await api.restoreGroup('L1', restore as never)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/groups/restore',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(restore) }),
    )
  })

  it('a list delete hands back the payload, and restoreList posts it back', async () => {
    const restore = { list: { id: 'L1' }, items: [], groups: [], snapshot: [], dismissals: [] }
    let fetchMock = stubFetch({ restore })

    expect(await api.deleteList('L1')).toEqual(restore)
    expect(fetchMock).toHaveBeenCalledWith('/api/lists/L1', expect.objectContaining({ method: 'DELETE' }))

    fetchMock = stubFetch({ id: 'L1' }, 201)
    await api.restoreList(restore as never)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/restore',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(restore) }),
    )
  })

  it('restoreItems replaces the whole item set', async () => {
    const set = { items: [], dismissals: [] }
    const fetchMock = stubFetch([])

    await api.restoreItems('L1', set)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lists/L1/items/restore-all',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(set) }),
    )
  })

  it('says why a list cannot be restored over an existing one', async () => {
    stubFetch({ code: 'list.alreadyExists' }, 409)

    await expect(api.restoreList({} as never)).rejects.toThrow('already exists')
  })
})
