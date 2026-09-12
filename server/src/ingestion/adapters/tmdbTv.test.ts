import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { ANIMATION_GENRE, createTmdbTvAdapter } from './tmdbTv.js'

/**
 * Fixtures are trimmed from real TMDB responses (verified live against
 * Breaking Bad, show 1396, and The Simpsons, show 456).
 */

const credentials = { apiKey: 'test-key', readAccessToken: undefined }
const TODAY = new Date().toISOString().slice(0, 10)

function router(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace('/3', '')
    const body = routes[path]

    return body === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 })
  })
}

const SHOWS = {
  results: [
    {
      id: 1396,
      name: 'Breaking Bad',
      first_air_date: '2008-01-20',
      genre_ids: [18, 80],
      origin_country: ['US'],
    },
    { id: 456, name: 'The Simpsons', first_air_date: '1989-12-17', genre_ids: [16, 35] },
  ],
}

const SHOW = {
  name: 'Breaking Bad',
  // Season 0 is specials.
  seasons: [
    { season_number: 0, episode_count: 9 },
    { season_number: 1, episode_count: 2 },
    { season_number: 2, episode_count: 1 },
  ],
}

const routes = {
  '/search/tv': SHOWS,
  '/tv/1396': SHOW,
  '/tv/1396/season/1': {
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Pilot', runtime: 59, air_date: '2008-01-20' },
      {
        season_number: 1,
        episode_number: 2,
        name: "Cat's in the Bag...",
        runtime: 49,
        air_date: '2008-01-27',
      },
    ],
  },
  '/tv/1396/season/2': {
    episodes: [
      { season_number: 2, episode_number: 1, name: 'Seven Thirty-Seven', air_date: '2009-03-08' },
    ],
  },
  '/tv/1396/season/0': {
    episodes: [
      { season_number: 0, episode_number: 1, name: 'A special', runtime: 3, air_date: '2009-02-17' },
    ],
  },
}

describe('TMDB television search', () => {
  it('finds shows, with year and country to tell reboots apart', async () => {
    const adapter = createTmdbTvAdapter(credentials, {}, router(routes))

    expect(await adapter.search('breaking bad')).toEqual([
      { externalRef: 'show:1396', title: 'Breaking Bad', detail: '2008 · US' },
      { externalRef: 'show:456', title: 'The Simpsons', detail: '1989' },
    ])
  })

  it('shows only animated series when filtered to that genre', async () => {
    // The animation category should not return live-action shows.
    const adapter = createTmdbTvAdapter(credentials, { genreFilter: ANIMATION_GENRE }, router(routes))

    expect((await adapter.search('anything')).map((source) => source.title)).toEqual([
      'The Simpsons',
    ])
  })

  it('is unavailable without credentials, like the film adapter', () => {
    expect(
      createTmdbTvAdapter({ apiKey: undefined, readAccessToken: undefined }).isAvailable(),
    ).toBe(false)
  })
})

describe('TMDB television expansion', () => {
  it('expands a show to its episodes, numbered and in order', async () => {
    const adapter = createTmdbTvAdapter(credentials, {}, router(routes))

    expect(await adapter.expand('show:1396')).toEqual([
      { title: 'S01E01 Pilot', timeToConsumeMinutes: 59, year: 2008 },
      { title: "S01E02 Cat's in the Bag...", timeToConsumeMinutes: 49, year: 2008 },
      { title: 'S02E01 Seven Thirty-Seven', year: 2009 },
      { title: 'S00E01 A special', timeToConsumeMinutes: 3, year: 2009 },
    ])
  })

  it('puts specials at the end, not ahead of the pilot', async () => {
    // They are included because people watch them and removing one is a click,
    // while adding a missed one means typing it back in.
    const adapter = createTmdbTvAdapter(credentials, {}, router(routes))
    const titles = (await adapter.expand('show:1396')).map((item) => item.title)

    expect(titles[0]).toBe('S01E01 Pilot')
    expect(titles.at(-1)).toBe('S00E01 A special')
  })

  it('leaves out episodes that have not aired', async () => {
    const adapter = createTmdbTvAdapter(
      credentials,
      {},
      router({
        '/tv/9': { seasons: [{ season_number: 1 }] },
        '/tv/9/season/1': {
          episodes: [
            { season_number: 1, episode_number: 1, name: 'Aired', air_date: '2020-01-01' },
            { season_number: 1, episode_number: 2, name: 'Next year', air_date: '2099-01-01' },
            { season_number: 1, episode_number: 3, name: 'Undated' },
            { season_number: 1, episode_number: 4, name: 'Out today', air_date: TODAY },
          ],
        },
      }),
    )

    // Today counts; the future and the undated do not.
    expect((await adapter.expand('show:9')).map((item) => item.title)).toEqual([
      'S01E01 Aired',
      'S01E04 Out today',
    ])
  })

  it('keeps the rest of a show when one season fails to load', async () => {
    const adapter = createTmdbTvAdapter(
      credentials,
      {},
      router({
        '/tv/1396': SHOW,
        '/tv/1396/season/1': routes['/tv/1396/season/1'],
        // Season 2 is missing entirely.
      }),
    )

    expect(await adapter.expand('show:1396')).toHaveLength(2)
  })

  it('names an episode by number when it has no title', async () => {
    const adapter = createTmdbTvAdapter(
      credentials,
      {},
      router({
        '/tv/9': { seasons: [{ season_number: 1 }] },
        '/tv/9/season/1': {
          episodes: [{ season_number: 1, episode_number: 7, air_date: '2020-01-01' }],
        },
      }),
    )

    expect((await adapter.expand('show:9'))[0]?.title).toBe('S01E07')
  })

  it('refuses refs that are not a numeric show id', async () => {
    const adapter = createTmdbTvAdapter(credentials, {}, router(routes))

    expect(await adapter.expand('show:abc')).toEqual([])
    expect(await adapter.expand('person:1396')).toEqual([])
  })

  it('does not request every season at once', async () => {
    // A long-running show has dozens of seasons, one request each.
    let inFlight = 0
    let peak = 0

    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      if (url.includes('/season/')) {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1

        return new Response(JSON.stringify({ episodes: [] }))
      }

      return new Response(
        JSON.stringify({
          seasons: Array.from({ length: 36 }, (_, index) => ({ season_number: index + 1 })),
        }),
      )
    })

    await createTmdbTvAdapter(credentials, {}, fetchImpl).expand('show:456')

    expect(peak).toBeLessThanOrEqual(5)
  })
})
