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
  it('merges films and seasons into release order', async () => {
    // The point of the category: one list interleaving both media, which
    // importing twice could never produce.
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect(await adapter.expand('franchise:180547')).toEqual([
      { title: 'Iron Man', externalRef: 'movie:1', timeToConsumeMinutes: 126, year: 2008 },
      { title: 'The Avengers', externalRef: 'movie:2', timeToConsumeMinutes: 143, year: 2012 },
      { title: 'Loki — Season 1', externalRef: 'season:10:1', timeToConsumeMinutes: 270, year: 2021 },
      { title: 'Loki — Season 2', externalRef: 'season:10:2', timeToConsumeMinutes: 270, year: 2023 },
    ])
  })

  it('counts a season as one entry, not an episode and not a whole show', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const titles = (await adapter.expand('franchise:180547')).map((item) => item.title)

    expect(titles).toContain('Loki — Season 1')
    expect(titles).toContain('Loki — Season 2')
    expect(titles).not.toContain('Loki')
  })

  it('sizes a season by its episode count times the show’s usual runtime', async () => {
    // One request per show rather than one per season.
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const loki = (await adapter.expand('franchise:180547')).find((item) =>
      item.title.startsWith('Loki'),
    )

    expect(loki?.timeToConsumeMinutes).toBe(6 * 45)
  })

  it('leaves out specials, unreleased films and unaired seasons', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))
    const titles = (await adapter.expand('franchise:180547')).map((item) => item.title)

    expect(titles).not.toContain('Loki — Season 0')
    expect(titles).not.toContain('Loki — Season 3')
    expect(titles).not.toContain('Announced Sequel')
  })

  it('leaves out documentaries about the franchise', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect(
      (await adapter.expand('franchise:180547')).map((item) => item.title),
    ).not.toContain('Marvel Studios: Assembled')
  })

  it('keeps the rest when one title’s details fail', async () => {
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({ ...routes, '/movie/1': undefined, '/tv/10': undefined }),
    )

    const items = await adapter.expand('franchise:180547')

    expect(items.map((item) => item.title)).toEqual(['Iron Man', 'The Avengers'])
    expect(items[0]?.timeToConsumeMinutes).toBeUndefined()
  })

  it('falls back to the last aired episode when episode_run_time is empty', async () => {
    // Which is every modern show: Loki, WandaVision and Moon Knight all
    // return []. Without this a 22-episode season took the category default
    // and read as two hours.
    const adapter = createTmdbFranchiseAdapter(
      credentials,
      router({
        ...routes,
        '/tv/10': {
          episode_run_time: [],
          last_episode_to_air: { runtime: 45 },
          seasons: [{ season_number: 1, episode_count: 22, air_date: '2013-09-24' }],
        },
      }),
    )

    const season = (await adapter.expand('franchise:180547')).find((item) =>
      item.title.includes('Season 1'),
    )

    expect(season?.timeToConsumeMinutes).toBe(22 * 45)
  })

  it('refuses refs that are not a numeric keyword', async () => {
    const adapter = createTmdbFranchiseAdapter(credentials, router(routes))

    expect(await adapter.expand('franchise:abc')).toEqual([])
    expect(await adapter.expand('movie:1')).toEqual([])
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

    expect(await adapter.expand('franchise:1')).toHaveLength(1)
  })
})
