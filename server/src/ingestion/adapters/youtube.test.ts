import { describe, expect, it, vi } from 'vitest'
import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { IngestionError, type FetchLike } from '../http.js'
import { createYouTubeAdapter, parseIsoDuration, parseYouTubeInput } from './youtube.js'

const credentials = { apiKey: 'test-key' }

function router(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const endpoint = new URL(url).pathname.split('/').pop()!
    const body = routes[endpoint]

    return body === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 })
  })
}

describe('parseYouTubeInput', () => {
  it('takes a playlist out of a link', () => {
    // Both the bare playlist URL and a video watched from inside one.
    expect(parseYouTubeInput('https://www.youtube.com/playlist?list=PLZHQObOWTQDP')).toEqual({
      kind: 'playlist',
      value: 'PLZHQObOWTQDP',
    })
    expect(parseYouTubeInput('https://www.youtube.com/watch?v=fNk_zzaMoSs&list=PLZHQObOWTQDP')).toEqual(
      { kind: 'playlist', value: 'PLZHQObOWTQDP' },
    )
  })

  it('takes a channel out of a link, in either modern form', () => {
    expect(parseYouTubeInput('https://youtube.com/@veritasium')).toEqual({
      kind: 'handle',
      value: '@veritasium',
    })
    expect(parseYouTubeInput('https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA')).toEqual({
      kind: 'channel',
      value: 'UCHnyfMqiRRG1u-2MsSQLbXA',
    })
  })

  it('falls back to searching for the legacy /c/ and /user/ forms', () => {
    // Neither has a direct lookup any more; the name is the best term left.
    expect(parseYouTubeInput('https://www.youtube.com/c/veritasium')).toEqual({
      kind: 'query',
      value: 'veritasium',
    })
    expect(parseYouTubeInput('https://www.youtube.com/user/1veritasium')).toEqual({
      kind: 'query',
      value: '1veritasium',
    })
  })

  it('accepts a bare handle or id', () => {
    expect(parseYouTubeInput('@veritasium')).toEqual({ kind: 'handle', value: '@veritasium' })
    expect(parseYouTubeInput('UCHnyfMqiRRG1u-2MsSQLbXA')).toEqual({
      kind: 'channel',
      value: 'UCHnyfMqiRRG1u-2MsSQLbXA',
    })
  })

  it('takes a video out of a link, in every form YouTube hands out', () => {
    const video = { kind: 'video', value: 'dQw4w9WgXcQ' }

    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(parseYouTubeInput(link)).toEqual(video)
    }
  })

  it('still reads a playlist out of a video link that names one', () => {
    expect(parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ?list=PLZHQObOWTQDP')).toEqual({
      kind: 'playlist',
      value: 'PLZHQObOWTQDP',
    })
  })

  it('reads a bare uploads id (UU…) as the channel it belongs to', () => {
    expect(parseYouTubeInput('UUHnyfMqiRRG1u-2MsSQLbXA')).toEqual({
      kind: 'channel',
      value: 'UCHnyfMqiRRG1u-2MsSQLbXA',
    })
  })

  it('reads a bare album (OLAK5uy_…), favourites (FL…) or mix (RD…) id as a playlist', () => {
    expect(parseYouTubeInput('OLAK5uy_kiwRYvPdVYD5m1G6RgfbGUUYsP2XqPxX0')).toEqual({
      kind: 'playlist',
      value: 'OLAK5uy_kiwRYvPdVYD5m1G6RgfbGUUYsP2XqPxX0',
    })
    expect(parseYouTubeInput('FLHnyfMqiRRG1u-2MsSQLbXA')).toEqual({
      kind: 'playlist',
      value: 'FLHnyfMqiRRG1u-2MsSQLbXA',
    })
    expect(parseYouTubeInput('RDdQw4w9WgXcQ')).toEqual({ kind: 'playlist', value: 'RDdQw4w9WgXcQ' })
  })

  it('has nothing to search for in a link it cannot read', () => {
    for (const input of [
      'https://example.com/some/page',
      'https://www.youtube.com/feed/subscriptions',
      'https://www.youtube.com/watch?v=tooshort',
    ]) {
      expect(parseYouTubeInput(input)).toEqual({ kind: 'unusable', value: input })
    }
  })

  it('treats anything else as a name to search for', () => {
    expect(parseYouTubeInput('3blue1brown')).toEqual({ kind: 'query', value: '3blue1brown' })
    expect(parseYouTubeInput('https://not a url')).toEqual({
      kind: 'query',
      value: 'https://not a url',
    })
  })
})

describe('parseIsoDuration', () => {
  it('converts the shapes YouTube actually returns', () => {
    expect(parseIsoDuration('PT4M13S')).toBe(4)
    expect(parseIsoDuration('PT1H2M13S')).toBe(62)
    expect(parseIsoDuration('PT45S')).toBe(1)
    expect(parseIsoDuration('PT2H')).toBe(120)
  })

  it('treats a zero-length live stream as unknown, not as zero', () => {
    // P0D would otherwise make a live stream the shortest thing on the list
    // and hand it to Quickie every time.
    expect(parseIsoDuration('P0D')).toBeUndefined()
    expect(parseIsoDuration(undefined)).toBeUndefined()
    expect(parseIsoDuration('nonsense')).toBeUndefined()
  })
})

describe('YouTube adapter', () => {
  it('is unavailable without a key', () => {
    expect(createYouTubeAdapter({ apiKey: undefined }).isAvailable()).toBe(false)
  })

  it('sees a key that appears after construction', () => {
    delete process.env['LISTULATOR_YT_TEST']
    const adapter = createYouTubeAdapter(() => ({ apiKey: process.env['LISTULATOR_YT_TEST'] }))

    expect(adapter.isAvailable()).toBe(false)
    process.env['LISTULATOR_YT_TEST'] = 'later'
    expect(adapter.isAvailable()).toBe(true)
    delete process.env['LISTULATOR_YT_TEST']
  })

  it('resolves a pasted playlist link without spending a search', async () => {
    // A search is one of the day's hundred (its own quota bucket); this path costs one unit
    // of the ten thousand.
    const fetchImpl = router({
      playlists: {
        items: [
          {
            id: 'PL123',
            snippet: { title: 'Essence of linear algebra', channelTitle: '3Blue1Brown' },
            contentDetails: { itemCount: 16 },
          },
        ],
      },
    })

    const sources = await createYouTubeAdapter(credentials, fetchImpl).search(
      'https://www.youtube.com/playlist?list=PL123',
    )

    expect(sources).toEqual([
      {
        externalRef: 'playlist:PL123',
        title: 'Essence of linear algebra',
        detail: 'Playlist · 3Blue1Brown · 16 videos',
      },
    ])
    expect(
      vi.mocked(fetchImpl).mock.calls.some(([url]) => url.includes('/search')),
    ).toBe(false)
  })

  it('offers a channel as both every upload and its playlists', async () => {
    const sources = await createYouTubeAdapter(
      credentials,
      router({
        channels: { items: [{ id: 'UC1', snippet: { title: 'Veritasium', customUrl: '@veritasium' } }] },
        playlists: {
          items: [
            { id: 'PLa', snippet: { title: 'Physics' }, contentDetails: { itemCount: 42 } },
          ],
        },
      }),
    ).search('@veritasium')

    expect(sources).toEqual([
      { externalRef: 'channel:UC1', title: 'Veritasium — every upload', detail: 'Channel · @veritasium' },
      { externalRef: 'playlist:PLa', title: 'Physics', detail: 'Playlist · Veritasium · 42 videos' },
    ])
  })

  it('searches by name when given one, covering channels and playlists at once', async () => {
    const fetchImpl = router({
      search: {
        items: [
          { id: { channelId: 'UC9' }, snippet: { title: 'Some Channel' } },
          { id: { playlistId: 'PL9' }, snippet: { title: 'Some Playlist', channelTitle: 'Them' } },
        ],
      },
    })

    const sources = await createYouTubeAdapter(credentials, fetchImpl).search('3blue1brown')

    expect(sources.map((source) => source.externalRef)).toEqual(['channel:UC9', 'playlist:PL9'])
    // One call rather than two, since each spends one of the day's hundred searches.
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => url.includes('/search'))).toHaveLength(1)
  })

  describe('input that is not a name', () => {
    const paths = (fetchImpl: FetchLike) =>
      vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).pathname.split('/').pop())

    it('offers the channel of a pasted video, and its playlists, for a few units and no search', async () => {
      const fetchImpl = router({
        videos: { items: [{ id: 'dQw4w9WgXcQ', snippet: { channelId: 'UC1', channelTitle: 'Rick Astley' } }] },
        playlists: { items: [{ id: 'PLa', snippet: { title: 'Hits' }, contentDetails: { itemCount: 7 } }] },
      })

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('https://youtu.be/dQw4w9WgXcQ')

      expect(sources).toEqual([
        {
          externalRef: 'channel:UC1',
          title: 'Rick Astley — every upload',
          detail: 'Channel · the channel of the video you pasted',
        },
        { externalRef: 'playlist:PLa', title: 'Hits', detail: 'Playlist · Rick Astley · 7 videos' },
      ])
      expect(paths(fetchImpl)).toEqual(['videos', 'playlists'])
      const [videoCall, playlistCall] = vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url))
      expect(videoCall!.searchParams.get('id')).toBe('dQw4w9WgXcQ')
      expect(playlistCall!.searchParams.get('channelId')).toBe('UC1')
    })

    it('offers nothing for a video that is gone, or that names no channel, and asks no more', async () => {
      const gone = router({ videos: { items: [] } })
      expect(await createYouTubeAdapter(credentials, gone).search('https://youtu.be/dQw4w9WgXcQ')).toEqual([])
      expect(paths(gone)).toEqual(['videos'])

      const orphan = router({ videos: { items: [{ id: 'dQw4w9WgXcQ', snippet: {} }] } })
      expect(await createYouTubeAdapter(credentials, orphan).search('https://youtu.be/dQw4w9WgXcQ')).toEqual([])
      expect(paths(orphan)).toEqual(['videos'])
    })

    it('names the channel by its id when the video does not give a title', async () => {
      const fetchImpl = router({
        videos: { items: [{ id: 'dQw4w9WgXcQ', snippet: { channelId: 'UC1' } }] },
        playlists: { items: [] },
      })

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('https://youtu.be/dQw4w9WgXcQ')

      expect(sources[0]?.title).toBe('UC1 — every upload')
    })

    it('fails a video link when the lookup fails, rather than saying nothing was found', async () => {
      const fetchImpl: FetchLike = vi.fn(async () => new Response('{}', { status: 400 }))

      await expect(
        createYouTubeAdapter(credentials, fetchImpl).search('https://youtu.be/dQw4w9WgXcQ'),
      ).rejects.toBeInstanceOf(IngestionError)
    })

    it('treats a bare uploads id as its channel, looked up by the channel id', async () => {
      const fetchImpl = router({
        channels: { items: [{ id: 'UC1', snippet: { title: 'Veritasium' } }] },
        playlists: { items: [] },
      })

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('UUHnyfMqiRRG1u-2MsSQLbXA')

      expect(sources.map((source) => source.externalRef)).toEqual(['channel:UC1'])
      expect(paths(fetchImpl)).toEqual(['channels', 'playlists'])
      expect(new URL(vi.mocked(fetchImpl).mock.calls[0]![0]).searchParams.get('id')).toBe('UCHnyfMqiRRG1u-2MsSQLbXA')
    })

    it('looks up a bare album, favourites or mix id as a playlist, one call', async () => {
      for (const id of ['OLAK5uy_kiwRYvPdVYD5m1G6RgfbGUUYsP2XqPxX0', 'FLHnyfMqiRRG1u-2MsSQLbXA', 'RDdQw4w9WgXcQ']) {
        const fetchImpl = router({
          playlists: { items: [{ id, snippet: { title: 'Album', channelTitle: 'Band' }, contentDetails: { itemCount: 9 } }] },
        })

        const sources = await createYouTubeAdapter(credentials, fetchImpl).search(id)

        expect(sources).toEqual([{ externalRef: `playlist:${id}`, title: 'Album', detail: 'Playlist · Band · 9 videos' }])
        expect(paths(fetchImpl)).toEqual(['playlists'])
        expect(new URL(vi.mocked(fetchImpl).mock.calls[0]![0]).searchParams.get('id')).toBe(id)
      }
    })

    it('offers nothing, and asks nothing, for a link it cannot read', async () => {
      for (const input of ['https://example.com/some/page', 'https://www.youtube.com/feed/subscriptions']) {
        const fetchImpl = router({})

        expect(await createYouTubeAdapter(credentials, fetchImpl).search(input)).toEqual([])
        expect(fetchImpl).not.toHaveBeenCalled()
      }
    })

    it('still searches by name for a legacy /c/ link, the one link whose name is worth a search', async () => {
      const fetchImpl = router({ search: { items: [] } })

      await createYouTubeAdapter(credentials, fetchImpl).search('https://www.youtube.com/c/veritasium')

      expect(paths(fetchImpl)).toEqual(['search'])
      expect(new URL(vi.mocked(fetchImpl).mock.calls[0]![0]).searchParams.get('q')).toBe('veritasium')
    })
  })

  it('asks for fifty results in the one name search, which costs the same as ten', async () => {
    const fetchImpl = router({ search: { items: [] } })

    await createYouTubeAdapter(credentials, fetchImpl).search('3blue1brown')

    const calls = vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('maxResults')).toBe('50')
    expect(calls[0]!.searchParams.has('pageToken')).toBe(false)
  })

  describe('a channel with many playlists', () => {
    const channel = { items: [{ id: 'UC1', snippet: { title: 'Veritasium' } }] }

    /** A channel keeping `total` playlists, answered fifty a page, pages numbered from 1. */
    function channelOf(total: number): FetchLike {
      return vi.fn(async (url: string) => {
        const parsed = new URL(url)
        if (!parsed.pathname.endsWith('/playlists')) return new Response(JSON.stringify(channel))

        const first = parsed.searchParams.has('pageToken') ? Number(parsed.searchParams.get('pageToken')) : 0
        const size = Number(parsed.searchParams.get('maxResults'))
        const last = Math.min(first + size, total)

        return new Response(
          JSON.stringify({
            items: Array.from({ length: last - first }, (_, index) => ({
              id: `PL${first + index}`,
              snippet: { title: `Playlist ${first + index}` },
              contentDetails: { itemCount: 1 },
            })),
            ...(last < total ? { nextPageToken: String(last) } : {}),
          }),
        )
      })
    }

    const playlistCalls = (fetchImpl: FetchLike) =>
      vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url)).filter((url) => url.pathname.endsWith('/playlists'))

    it('offers every playlist when it keeps sixty, asking for fifty a page', async () => {
      const fetchImpl = channelOf(60)

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('@veritasium')

      expect(sources).toHaveLength(61)
      expect(sources.at(-1)?.externalRef).toBe('playlist:PL59')
      const calls = playlistCalls(fetchImpl)
      expect(calls).toHaveLength(2)
      expect(calls[0]!.searchParams.get('maxResults')).toBe('50')
      expect(calls[0]!.searchParams.has('pageToken')).toBe(false)
      expect(calls[1]!.searchParams.get('pageToken')).toBe('50')
    })

    it('stops at a hundred playlists, and does not ask for a third page', async () => {
      const fetchImpl = channelOf(500)

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('@veritasium')

      expect(sources).toHaveLength(101)
      expect(sources.at(-1)?.externalRef).toBe('playlist:PL99')
      expect(playlistCalls(fetchImpl)).toHaveLength(2)
    })

    it('keeps a hundred even when the API hands over more than it was asked for', async () => {
      const fetchImpl: FetchLike = vi.fn(async (url: string) =>
        new URL(url).pathname.endsWith('/playlists')
          ? new Response(
              JSON.stringify({
                items: Array.from({ length: 70 }, (_, index) => ({ id: `PL${index}`, snippet: { title: 'p' } })),
                nextPageToken: 'more',
              }),
            )
          : new Response(JSON.stringify(channel)),
      )

      expect(await createYouTubeAdapter(credentials, fetchImpl).search('@veritasium')).toHaveLength(101)
    })

    it('asks once for a channel with no playlists, and offers its uploads', async () => {
      const fetchImpl = channelOf(0)

      const sources = await createYouTubeAdapter(credentials, fetchImpl).search('@veritasium')

      expect(sources.map((source) => source.externalRef)).toEqual(['channel:UC1'])
      expect(playlistCalls(fetchImpl)).toHaveLength(1)
    })

    it('fails the search when a later page fails, rather than offering half the playlists', async () => {
      const first = channelOf(500)
      const fetchImpl: FetchLike = vi.fn(async (url: string, init?: RequestInit) =>
        new URL(url).searchParams.has('pageToken') ? new Response('{}', { status: 400 }) : first(url, init),
      )

      await expect(createYouTubeAdapter(credentials, fetchImpl).search('@veritasium')).rejects.toBeInstanceOf(
        IngestionError,
      )
    })
  })

  it('expands a playlist in its own order, with durations', async () => {
    const adapter = createYouTubeAdapter(
      credentials,
      router({
        playlistItems: {
          items: [
            { snippet: { title: 'Chapter 1', resourceId: { videoId: 'v1' } } },
            { snippet: { title: 'Chapter 2', resourceId: { videoId: 'v2' } } },
          ],
        },
        videos: {
          items: [
            { id: 'v1', contentDetails: { duration: 'PT10M30S' } },
            { id: 'v2', contentDetails: { duration: 'PT12M' } },
          ],
        },
      }),
    )

    expect((await adapter.expand('playlist:PL1')).items).toEqual([
      { title: 'Chapter 1', externalRef: 'video:v1', timeToConsumeMinutes: 11 },
      { title: 'Chapter 2', externalRef: 'video:v2', timeToConsumeMinutes: 12 },
    ])
  })

  it('keeps deleted and private entries rather than hiding the gap', async () => {
    // Something was there. Seeing it is worth more than a tidy list, and a
    // private video may be published later and picked up by a refresh.
    const adapter = createYouTubeAdapter(
      credentials,
      router({
        playlistItems: {
          items: [
            { snippet: { title: 'A real video', resourceId: { videoId: 'v1' } } },
            { snippet: { title: 'Deleted video' } },
            { snippet: { title: 'Private video' } },
          ],
        },
        videos: { items: [{ id: 'v1', contentDetails: { duration: 'PT5M' } }] },
      }),
    )

    const items = (await adapter.expand('playlist:PL1')).items

    expect(items.map((item) => item.title)).toEqual([
      'A real video',
      'Deleted video',
      'Private video',
    ])
    // No id and no duration; they fall back to the category default.
    expect(items[1]).toEqual({ title: 'Deleted video' })
  })

  it('reverses a channel’s uploads, which arrive newest first', async () => {
    const adapter = createYouTubeAdapter(
      credentials,
      router({
        channels: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] },
        playlistItems: {
          items: [
            { snippet: { title: 'Newest', resourceId: { videoId: 'v3' } } },
            { snippet: { title: 'Middle', resourceId: { videoId: 'v2' } } },
            { snippet: { title: 'Oldest', resourceId: { videoId: 'v1' } } },
          ],
        },
        videos: { items: [] },
      }),
    )

    expect((await adapter.expand('channel:UC1')).items.map((item) => item.title)).toEqual([
      'Oldest',
      'Middle',
      'Newest',
    ])
  })

  it('pages through a long playlist until the token runs out', async () => {
    let page = 0
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.includes('playlistItems')) {
        page += 1

        return new Response(
          JSON.stringify({
            items: Array.from({ length: 50 }, (_, index) => ({
              snippet: { title: `Video ${page}-${index}`, resourceId: { videoId: `v${page}-${index}` } },
            })),
            ...(page < 3 ? { nextPageToken: `page${page}` } : {}),
          }),
        )
      }

      return new Response(JSON.stringify({ items: [] }))
    })

    expect((await createYouTubeAdapter(credentials, fetchImpl).expand('playlist:PL1')).items).toHaveLength(150)
  })

  it('returns nothing for a ref it does not understand', async () => {
    const adapter = createYouTubeAdapter(credentials, router({}))

    expect((await adapter.expand('video:abc')).items).toEqual([])
    expect((await adapter.expand('nonsense')).items).toEqual([])
  })

  describe('a long channel', () => {
    /** A channel of `total` uploads as the API serves it: newest first, fifty to a page, durations by id. */
    function channelOf(total: number): FetchLike {
      return vi.fn(async (url: string) => {
        const parsed = new URL(url)
        const endpoint = parsed.pathname.split('/').pop()

        if (endpoint === 'channels') {
          return new Response(JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }))
        }

        if (endpoint === 'playlistItems') {
          const start = Number(parsed.searchParams.get('pageToken') ?? 0)
          const count = Math.min(50, total - start)

          return new Response(
            JSON.stringify({
              items: Array.from({ length: count }, (_, index) => {
                const number = total - (start + index)

                return { snippet: { title: `Upload ${number}`, resourceId: { videoId: `v${number}` } } }
              }),
              ...(start + count < total ? { nextPageToken: String(start + count) } : {}),
            }),
          )
        }

        const ids = (parsed.searchParams.get('id') ?? '').split(',')

        return new Response(
          JSON.stringify({ items: ids.map((id) => ({ id, contentDetails: { duration: 'PT7M' } })) }),
        )
      })
    }

    it('lists every upload past a thousand, oldest first, not just the newest thousand', async () => {
      // A cap of 1,000 used to cut the channel's oldest uploads after the newest-first order was
      // reversed: the first video a completionist wants was the one dropped.
      const { items } = await createYouTubeAdapter(credentials, channelOf(1200)).expand('channel:UC1')

      expect(items).toHaveLength(1200)
      expect(items[0]).toEqual({ title: 'Upload 1', externalRef: 'video:v1', timeToConsumeMinutes: 7 })
      expect(items[1199]!.title).toBe('Upload 1200')
    })

    it('stops paging once it is past what a list can hold, and spends nothing on lengths', async () => {
      // The shared size check refuses the list; fetching its lengths first would cost about two hundred
      // quota units for nothing.
      const fetchImpl = channelOf(MAX_LIST_ITEMS + 500)
      const { items } = await createYouTubeAdapter(credentials, fetchImpl).expand('channel:UC1')
      const calls = vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).pathname.split('/').pop())

      expect(items.length).toBeGreaterThan(MAX_LIST_ITEMS)
      expect(items.length).toBeLessThan(MAX_LIST_ITEMS + 500)
      expect(calls.filter((call) => call === 'videos')).toHaveLength(0)
      expect(calls.filter((call) => call === 'playlistItems')).toHaveLength(Math.ceil((MAX_LIST_ITEMS + 1) / 50))
    })

    it('keeps a list of exactly the most a list can hold, lengths included', async () => {
      const { items } = await createYouTubeAdapter(credentials, channelOf(MAX_LIST_ITEMS)).expand('channel:UC1')

      expect(items).toHaveLength(MAX_LIST_ITEMS)
      expect(items.every((item) => item.timeToConsumeMinutes === 7)).toBe(true)
    })

    it('asks for lengths a few batches at a time, and every length still lands on its own video', async () => {
      let inFlight = 0
      let peak = 0
      const base = channelOf(1000)
      const fetchImpl: FetchLike = vi.fn(async (url: string) => {
        if (!url.includes('/videos')) return base(url)

        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1

        const ids = (new URL(url).searchParams.get('id') ?? '').split(',')

        // The length is the video's own number, so a mix-up between batches would show.
        return new Response(
          JSON.stringify({
            items: ids.map((id) => ({ id, contentDetails: { duration: `PT${Number(id.slice(1))}M` } })),
          }),
        )
      })

      const { items } = await createYouTubeAdapter(credentials, fetchImpl).expand('channel:UC1')

      expect(peak).toBeGreaterThan(1)
      expect(peak).toBeLessThanOrEqual(5)
      expect(items.every((item) => item.timeToConsumeMinutes === Number(item.externalRef!.slice(7)))).toBe(true)
    })
  })

  describe('a count', () => {
    /** One `playlistItems` answer of a single entry, carrying the playlist's total as the API does. */
    function totals(total: number | undefined): FetchLike {
      return vi.fn(async (url: string) => {
        const endpoint = new URL(url).pathname.split('/').pop()

        if (endpoint === 'channels') {
          return new Response(JSON.stringify({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }))
        }

        return new Response(
          JSON.stringify({
            items: [{ snippet: { title: 'One', resourceId: { videoId: 'v1' } } }],
            ...(total === undefined ? {} : { pageInfo: { totalResults: total, resultsPerPage: 1 } }),
          }),
        )
      })
    }

    const endpoints = (fetchImpl: FetchLike) =>
      vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).pathname.split('/').pop())

    it('is one request for a playlist, and the whole total, not a page of it', async () => {
      // The Search tab asks for a count of every result; listing a 6,000-video channel for it cost
      // about 250 quota units a row.
      const fetchImpl = totals(6184)

      expect(await createYouTubeAdapter(credentials, fetchImpl).count!('playlist:PL1')).toBe(6184)
      expect(endpoints(fetchImpl)).toEqual(['playlistItems'])
      // A full page: a mix (`RD...`) counts as many entries as the page it is asked for, so asking for one says 1.
      expect(new URL(vi.mocked(fetchImpl).mock.calls[0]![0]).searchParams.get('maxResults')).toBe('50')
    })

    it('is two requests for a channel: its uploads playlist, then that playlist’s total', async () => {
      const fetchImpl = totals(6184)

      expect(await createYouTubeAdapter(credentials, fetchImpl).count!('channel:UC1')).toBe(6184)
      expect(endpoints(fetchImpl)).toEqual(['channels', 'playlistItems'])
      expect(new URL(vi.mocked(fetchImpl).mock.calls[1]![0]).searchParams.get('playlistId')).toBe('UU1')
    })

    it('has no answer for a ref it does not understand, or when the API gives no total, so a listing decides', async () => {
      expect(await createYouTubeAdapter(credentials, totals(5)).count!('video:abc')).toBeUndefined()
      expect(await createYouTubeAdapter(credentials, totals(undefined)).count!('playlist:PL1')).toBeUndefined()
    })

    it('has no answer for a channel the API does not know, and asks nothing more', async () => {
      const fetchImpl = router({ channels: { items: [] } })
      const adapter = createYouTubeAdapter(credentials, fetchImpl)

      expect(await adapter.count!('channel:UCnone')).toBeUndefined()
      expect((await adapter.expand('channel:UCnone')).items).toEqual([])
      expect(vi.mocked(fetchImpl).mock.calls.every(([url]) => new URL(url).pathname.endsWith('/channels'))).toBe(true)
    })

    it('fails when the request fails, rather than answering zero', async () => {
      const fetchImpl: FetchLike = vi.fn(async () => new Response('{}', { status: 400 }))

      await expect(createYouTubeAdapter(credentials, fetchImpl).count!('playlist:PL1')).rejects.toBeInstanceOf(IngestionError)
    })
  })

  describe('failures', () => {
    const noWait = async (): Promise<void> => {}
    const quotaBody = JSON.stringify({ error: { code: 403, message: 'x', errors: [{ reason: 'quotaExceeded' }] } })

    /** The first calls to each endpoint fail as told, then it answers like `router`. */
    function failingThen(failures: Response[], routes: Record<string, unknown>): FetchLike {
      const pending = [...failures]

      return vi.fn(async (url: string) => {
        const next = pending.shift()
        if (next) return next

        const body = routes[new URL(url).pathname.split('/').pop()!]

        return new Response(JSON.stringify(body ?? {}))
      })
    }

    const playlist = {
      playlistItems: { items: [{ snippet: { title: 'One', resourceId: { videoId: 'v1' } } }] },
      videos: { items: [{ id: 'v1', contentDetails: { duration: 'PT5M' } }] },
    }

    it('fails the listing when a batch of lengths fails, rather than guessing fifty lengths', async () => {
      // A swallowed failure turned fifty videos into 20-minute estimates with no word to anyone.
      const fetchImpl: FetchLike = vi.fn(async (url: string) =>
        url.includes('/videos')
          ? new Response('{}', { status: 400 })
          : new Response(JSON.stringify(playlist.playlistItems)),
      )

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).expand('playlist:PL1')).rejects.toBeInstanceOf(
        IngestionError,
      )
    })

    it('fails a channel search when its playlists cannot be listed, rather than offering the uploads alone', async () => {
      const fetchImpl: FetchLike = vi.fn(async (url: string) =>
        url.includes('/playlists')
          ? new Response('{}', { status: 400 })
          : new Response(JSON.stringify({ items: [{ id: 'UC1', snippet: { title: 'Veritasium' } }] })),
      )

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).search('@veritasium')).rejects.toBeInstanceOf(
        IngestionError,
      )
    })

    it('tries a 503 again and lists what the second answer holds', async () => {
      const fetchImpl = failingThen([new Response('{}', { status: 503 })], playlist)
      const sleep = vi.fn<(ms: number) => Promise<void>>(noWait)

      const { items } = await createYouTubeAdapter(credentials, fetchImpl, { sleep }).expand('playlist:PL1')

      expect(items).toHaveLength(1)
      expect(sleep).toHaveBeenCalledWith(500)
    })

    it('waits as long as a 429 asks, and doubles the wait between plain failures', async () => {
      const sleep = vi.fn<(ms: number) => Promise<void>>(noWait)
      const asked = failingThen([new Response('{}', { status: 429, headers: { 'retry-after': '2' } })], playlist)

      await createYouTubeAdapter(credentials, asked, { sleep }).expand('playlist:PL1')
      expect(sleep).toHaveBeenLastCalledWith(2000)

      sleep.mockClear()
      const plain = failingThen([new Response('{}', { status: 500 }), new Response('{}', { status: 500 })], playlist)

      await createYouTubeAdapter(credentials, plain, { sleep }).expand('playlist:PL1')
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000])
    })

    it('tries a Google rate limit (a 403) again, as a 429', async () => {
      const body = JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } })
      const fetchImpl = failingThen([new Response(body, { status: 403 })], playlist)

      expect((await createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).expand('playlist:PL1')).items).toHaveLength(1)
    })

    it('gives up after three tries and says what the upstream said', async () => {
      const fetchImpl = failingThen(
        [new Response('{}', { status: 503 }), new Response('{}', { status: 503 }), new Response('{}', { status: 503 })],
        playlist,
      )

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).expand('playlist:PL1')).rejects.toThrow(
        'YouTube returned 503',
      )
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('does not wait out a Retry-After longer than ten seconds', async () => {
      const fetchImpl = failingThen([new Response('{}', { status: 429, headers: { 'retry-after': '60' } })], playlist)
      const sleep = vi.fn<(ms: number) => Promise<void>>(noWait)

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep }).expand('playlist:PL1')).rejects.toThrow('rate-limiting')
      expect(sleep).not.toHaveBeenCalled()
    })

    it('does wait a Retry-After of exactly ten seconds', async () => {
      const fetchImpl = failingThen([new Response('{}', { status: 429, headers: { 'retry-after': '10' } })], playlist)
      const sleep = vi.fn<(ms: number) => Promise<void>>(noWait)

      await createYouTubeAdapter(credentials, fetchImpl, { sleep }).expand('playlist:PL1')

      expect(sleep).toHaveBeenCalledWith(10_000)
    })

    it('does not try a spent daily quota again, and says it is the quota', async () => {
      // It will not mend in a second; and it is not a bad key, which is what a bare 403 reads as.
      const fetchImpl = failingThen([new Response(quotaBody, { status: 403 })], playlist)

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).expand('playlist:PL1')).rejects.toThrow(
        'daily quota is used up',
      )
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('does not try a 400 again', async () => {
      const fetchImpl = failingThen([new Response('{}', { status: 400 })], playlist)

      await expect(createYouTubeAdapter(credentials, fetchImpl, { sleep: noWait }).expand('playlist:PL1')).rejects.toThrow('YouTube returned 400')
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })
})
