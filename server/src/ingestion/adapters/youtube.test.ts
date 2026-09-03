import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
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
    delete process.env['DULDULATOR_YT_TEST']
    const adapter = createYouTubeAdapter(() => ({ apiKey: process.env['DULDULATOR_YT_TEST'] }))

    expect(adapter.isAvailable()).toBe(false)
    process.env['DULDULATOR_YT_TEST'] = 'later'
    expect(adapter.isAvailable()).toBe(true)
    delete process.env['DULDULATOR_YT_TEST']
  })

  it('resolves a pasted playlist link without spending a search', async () => {
    // A search costs a hundred quota units against a daily ten thousand; this
    // path costs one.
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
    // One call rather than two, since each costs a hundred units.
    expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => url.includes('/search'))).toHaveLength(1)
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

    expect(await adapter.expand('playlist:PL1')).toEqual([
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

    const items = await adapter.expand('playlist:PL1')

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

    expect((await adapter.expand('channel:UC1')).map((item) => item.title)).toEqual([
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

    expect(await createYouTubeAdapter(credentials, fetchImpl).expand('playlist:PL1')).toHaveLength(150)
  })

  it('returns nothing for a ref it does not understand', async () => {
    const adapter = createYouTubeAdapter(credentials, router({}))

    expect(await adapter.expand('video:abc')).toEqual([])
    expect(await adapter.expand('nonsense')).toEqual([])
  })
})
