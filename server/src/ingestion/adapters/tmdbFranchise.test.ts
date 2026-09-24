import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { CURATED_FRANCHISES, createTmdbFranchiseAdapter } from './tmdbFranchise.js'

/** Fixtures are shaped from real TMDB responses for keyword 180547 (the MCU). */

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

const routes = {
  '/discover/movie': {
    total_pages: 1,
    results: [
      { id: 1, title: 'Iron Man', release_date: '2008-04-30', genre_ids: [28] },
      { id: 2, title: 'The Avengers', release_date: '2012-04-25', genre_ids: [878] },
      // Behind-the-scenes, about the franchise rather than part of it.
      { id: 3, title: 'Marvel Studios: Assembled', release_date: '2021-03-12', genre_ids: [99] },
      { id: 4, title: 'Announced Sequel', release_date: '2099-01-01', genre_ids: [28] },
    ],
  },
  '/discover/tv': {
    total_pages: 1,
    results: [{ id: 10, name: 'Loki', first_air_date: '2021-06-09', genre_ids: [18] }],
  },
  '/movie/1': { runtime: 126 },
  '/movie/2': { runtime: 143 },
  '/tv/10': {
    episode_run_time: [45],
    last_episode_to_air: { runtime: 50 },
    seasons: [
      { season_number: 0, episode_count: 3, air_date: '2021-06-01' },
      { season_number: 1, episode_count: 6, air_date: '2021-06-09' },
      { season_number: 2, episode_count: 6, air_date: '2023-10-05' },
      { season_number: 3, episode_count: 6, air_date: '2099-01-01' },
    ],
  },
  '/tv/10/season/1': {
    episodes: [
      {
        episode_number: 1,
        season_number: 1,
        name: 'Glorious Purpose',
        runtime: 51,
        air_date: '2021-06-09',
      },
      {
        episode_number: 2,
        season_number: 1,
        name: 'The Variant',
        runtime: 47,
        air_date: '2021-06-16',
      },
      // No runtime of its own: takes the show's usual one, marked estimated.
      { episode_number: 3, season_number: 1, name: 'Lamentis', air_date: '2021-06-23' },
    ],
  },
  '/tv/10/season/2': {
    episodes: [
      {
        episode_number: 1,
        season_number: 2,
        name: 'Ouroboros',
        runtime: 53,
        air_date: '2023-10-05',
      },
      // Announced but not aired yet.
      {
        episode_number: 2,
        season_number: 2,
        name: 'Breaking Brad',
        runtime: 45,
        air_date: '2099-01-01',
      },
    ],
  },
}

describe('curated franchises', () => {
  it('names only the keywords measured to be worth offering', () => {
    // Marvel returns 81 films and 36 series; Star Wars manages 8 films and
    // Middle-earth 1, which is too sparse to build a list from.
    expect(CURATED_FRANCHISES.map((franchise) => franchise.title)).toEqual([
      'Marvel Cinematic Universe',
      'Star Trek',
      'DC Extended Universe',
    ])
  })
})

describe('franchise search', () => {
  it('offers a curated franchise ahead of raw keyword matches', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({ '/search/keyword': { results: [{ id: 999, name: 'marvel comics' }] } }),
    )

    const sources = await adapter.search('marvel')

    expect(sources[0]).toEqual({
      externalRef: 'franchise:180547',
      title: 'Marvel Cinematic Universe',
      detail: 'Films and series, in release order',
    })
    expect(sources[1]).toMatchObject({ externalRef: 'franchise:999' })
  })

  it('does not list a curated franchise twice when the keyword also matches', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({
        '/search/keyword': {
          results: [{ id: 180547, name: 'marvel cinematic universe (mcu)' }],
        },
      }),
    )

    expect(await adapter.search('marvel')).toHaveLength(1)
  })
})

describe('franchise expansion', () => {
  it('merges films and episodes into release order', async () => {
    // The point of the category: one list interleaving both media, which
    // importing twice could never produce.
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect((await adapter.expand('franchise:180547')).items.map((item) => item.title)).toEqual([
      'Iron Man',
      'The Avengers',
      'Loki S01E01 Glorious Purpose',
      'Loki S01E02 The Variant',
      'Loki S01E03 Lamentis',
      'Loki S02E01 Ouroboros',
    ])
  })

  it('emits one row per episode, grouped by season (C3)', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const items = (await adapter.expand('franchise:180547')).items
    const loki = items.filter((item) => item.title.startsWith('Loki'))

    expect(loki.map((item) => item.group)).toEqual([
      'Loki — Season 1',
      'Loki — Season 1',
      'Loki — Season 1',
      'Loki — Season 2',
    ])
    expect(loki[0]).toEqual({
      title: 'Loki S01E01 Glorious Purpose',
      externalRef: 'episode:10:1:1',
      timeToConsumeMinutes: 51,
      year: 2021,
      group: 'Loki — Season 1',
    })
    // Films carry no group.
    expect(items[0]).not.toHaveProperty('group')
  })

  it('gives each episode its own runtime, falling back to the show’s usual one', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const loki = (await adapter.expand('franchise:180547')).items.filter((item) =>
      item.title.startsWith('Loki'),
    )

    expect(loki.map((item) => item.timeToConsumeMinutes)).toEqual([51, 47, 45, 53])
  })

  it('leaves the runtime unset when neither the episode nor the show has one', async () => {
    // The import then applies the category default and marks it estimated,
    // so time_to_consume_minutes is never null.
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({
        ...routes,
        '/tv/10': { ...routes['/tv/10'], episode_run_time: [], last_episode_to_air: undefined },
      }),
    )
    const lamentis = (await adapter.expand('franchise:180547')).items.find((item) =>
      item.title.includes('Lamentis'),
    )

    expect(lamentis?.timeToConsumeMinutes).toBeUndefined()
  })

  it('leaves out specials, unreleased films, unaired seasons and unaired episodes', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const titles = (await adapter.expand('franchise:180547')).items.map((item) => item.title)

    expect(titles.some((title) => title.includes('S00'))).toBe(false)
    expect(titles.some((title) => title.includes('S03'))).toBe(false)
    expect(titles).not.toContain('Loki S02E02 Breaking Brad')
    expect(titles).not.toContain('Announced Sequel')
  })

  it('asks for each aired season once, and never for unaired ones', async () => {
    const fetchImpl = router(routes)
    await createTmdbFranchiseAdapter(credentials, fetchImpl).expand('franchise:180547')

    const paths = vi
      .mocked(fetchImpl)
      .mock.calls.map(([url]) => new URL(String(url)).pathname.replace('/3', ''))
      .filter((path) => path.includes('/season/'))
      .sort()

    expect(paths).toEqual(['/tv/10/season/1', '/tv/10/season/2'])
  })

  it('leaves out documentaries about the franchise', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect(
      (await adapter.expand('franchise:180547')).items.map((item) => item.title),
    ).not.toContain('Marvel Studios: Assembled')
  })

  it('keeps the rest when one title’s details fail', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({ ...routes, '/movie/1': undefined, '/tv/10': undefined }),
    )

    const items = (await adapter.expand('franchise:180547')).items

    expect(items.map((item) => item.title)).toEqual(['Iron Man', 'The Avengers'])
    expect(items[0]?.timeToConsumeMinutes).toBeUndefined()
  })

  it('costs one season, not the show, when a season’s details fail', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({ ...routes, '/tv/10/season/1': undefined }),
    )

    expect((await adapter.expand('franchise:180547')).items.map((item) => item.title)).toContain(
      'Loki S02E01 Ouroboros',
    )
  })

  it('falls back to the last aired episode when episode_run_time is empty', async () => {
    // Which is every modern show: Loki, WandaVision and Moon Knight all
    // return []. Without this an episode with no runtime of its own took the
    // category default.
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({
        ...routes,
        '/tv/10': {
          episode_run_time: [],
          last_episode_to_air: { runtime: 44 },
          seasons: [{ season_number: 1, episode_count: 3, air_date: '2021-06-09' }],
        },
      }),
    )

    const lamentis = (await adapter.expand('franchise:180547')).items.find((item) =>
      item.title.includes('Lamentis'),
    )

    expect(lamentis?.timeToConsumeMinutes).toBe(44)
  })

  it('refuses refs that are not a numeric keyword', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect((await adapter.expand('franchise:abc')).items).toEqual([])
    expect((await adapter.expand('movie:1')).items).toEqual([])
  })

  it('counts a film released today', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({
        '/discover/movie': {
          total_pages: 1,
          results: [{ id: 7, title: 'Out Today', release_date: TODAY, genre_ids: [28] }],
        },
        '/discover/tv': { total_pages: 1, results: [] },
        '/movie/7': { runtime: 100 },
      }),
    )

    expect((await adapter.expand('franchise:1')).items).toHaveLength(1)
  })
})
