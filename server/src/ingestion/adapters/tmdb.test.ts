import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { createTmdbAdapter } from './tmdb.js'

/**
 * Fixtures are trimmed from real TMDB responses (verified live against Jackie
 * Chan, person 18897), so the shapes mapped here are the shapes the service
 * actually returns.
 */

const TODAY = new Date().toISOString().slice(0, 10)
const PAST = '1998-09-18'
const FUTURE = '2099-01-01'

/** Routes by URL path, so one fake covers a multi-request expansion. */
function router(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace('/3', '')
    const body = routes[path]

    return body === undefined
      ? new Response('{"status_message":"Not found"}', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 })
  })
}

const credentials = { apiKey: 'test-key', readAccessToken: undefined }

describe('TMDB adapter availability', () => {
  it('is unavailable with no credentials, so the category simply has no search', () => {
    expect(
      createTmdbAdapter({ apiKey: undefined, readAccessToken: undefined }).isAvailable(),
    ).toBe(false)
  })

  it('is available with either credential', () => {
    expect(createTmdbAdapter({ apiKey: 'k', readAccessToken: undefined }).isAvailable()).toBe(true)
    expect(createTmdbAdapter({ apiKey: undefined, readAccessToken: 't' }).isAvailable()).toBe(true)
  })

  it('sends the v3 key as a query parameter', async () => {
    const fetchImpl = router({ '/search/person': {}, '/search/collection': {} })
    await createTmdbAdapter(credentials, fetchImpl).search('x')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain('api_key=test-key')
  })

  it('prefers the v4 token as a bearer header, and keeps the key out of the URL', async () => {
    const fetchImpl = router({ '/search/person': {}, '/search/collection': {} })
    await createTmdbAdapter({ apiKey: 'k', readAccessToken: 'token' }, fetchImpl).search('x')

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect((init?.headers as Record<string, string>)['authorization']).toBe('Bearer token')
    expect(url).not.toContain('api_key')
  })
})

describe('TMDB search', () => {
  const routes = {
    '/search/person': {
      results: [
        {
          id: 18897,
          name: 'Jackie Chan',
          known_for_department: 'Acting',
          known_for: [{ title: 'Rush Hour' }, { title: 'Police Story' }],
        },
        { id: 4720878, name: 'Jackie Chan', known_for_department: 'Acting' },
      ],
    },
    '/search/collection': { results: [{ id: 645, name: 'James Bond Collection' }] },
  }

  it('offers both collections and filmographies as things to track', async () => {
    const adapter = createTmdbAdapter(credentials, router(routes))

    expect(await adapter.search('jackie chan')).toEqual([
      { externalRef: 'collection:645', title: 'James Bond Collection', detail: 'Collection' },
      {
        externalRef: 'person:18897',
        title: 'Jackie Chan — filmography',
        detail: 'Acting · Rush Hour, Police Story',
      },
      { externalRef: 'person:4720878', title: 'Jackie Chan — filmography', detail: 'Acting' },
    ])
  })

  it('names best-known films, because the same name comes back several times', async () => {
    // Searching "jackie chan" really does return three different people.
    const adapter = createTmdbAdapter(credentials, router(routes))
    const [, first, second] = await adapter.search('jackie chan')

    expect(first?.detail).not.toBe(second?.detail)
  })
})

describe('TMDB expansion', () => {
  const CAST = [
    { id: 2109, title: 'Rush Hour', release_date: PAST, genre_ids: [28, 35] },
    { id: 10044, title: 'My Lucky Stars', release_date: '1985-02-10', genre_ids: [28] },
    { id: 999, title: 'A Documentary About Stunts', release_date: PAST, genre_ids: [99] },
    { id: 998, title: 'Untitled Sequel', release_date: FUTURE, genre_ids: [28] },
    { id: 997, title: 'No Date At All', genre_ids: [28] },
  ]

  const routes = {
    '/person/18897/movie_credits': { cast: CAST },
    '/movie/2109': { runtime: 97 },
    '/movie/10044': { runtime: 96 },
  }

  it('expands a filmography chronologically, with real runtimes', async () => {
    const adapter = createTmdbAdapter(credentials, router(routes))

    expect(await adapter.expand('person:18897')).toEqual([
      { title: 'My Lucky Stars', externalRef: 'movie:10044', timeToConsumeMinutes: 96 },
      { title: 'Rush Hour', externalRef: 'movie:2109', timeToConsumeMinutes: 97 },
    ])
  })

  it('drops documentaries, unreleased films and undated entries', async () => {
    // A filmography padded with a documentary about the person, and with
    // films that do not exist yet, is not a thing you can finish.
    const adapter = createTmdbAdapter(credentials, router(routes))
    const titles = (await adapter.expand('person:18897')).map((item) => item.title)

    expect(titles).not.toContain('A Documentary About Stunts')
    expect(titles).not.toContain('Untitled Sequel')
    expect(titles).not.toContain('No Date At All')
  })

  it('keeps the rest when one film’s details fail', async () => {
    // 404 on one lookup should cost that film its runtime, not lose the list.
    const adapter = createTmdbAdapter(credentials, router({ ...routes, '/movie/2109': undefined }))

    const items = await adapter.expand('person:18897')
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.title === 'Rush Hour')?.timeToConsumeMinutes).toBeUndefined()
  })

  it('expands a collection the same way', async () => {
    const adapter = createTmdbAdapter(
      credentials,
      router({
        '/collection/645': {
          parts: [
            { id: 2109, title: 'Rush Hour', release_date: PAST },
            { id: 10044, title: 'My Lucky Stars', release_date: '1985-02-10' },
          ],
        },
        '/movie/2109': { runtime: 97 },
        '/movie/10044': { runtime: 96 },
      }),
    )

    expect((await adapter.expand('collection:645')).map((item) => item.title)).toEqual([
      'My Lucky Stars',
      'Rush Hour',
    ])
  })

  it('returns nothing for a ref it does not understand', async () => {
    const adapter = createTmdbAdapter(credentials, router({}))

    expect(await adapter.expand('nonsense')).toEqual([])
  })

  it('handles a person with no credits', async () => {
    const adapter = createTmdbAdapter(credentials, router({ '/person/1/movie_credits': {} }))

    expect(await adapter.expand('person:1')).toEqual([])
  })

  it('does not fire hundreds of detail requests at once', async () => {
    // A prolific filmography is 200+ films; all in flight together would be
    // rude to TMDB and could exhaust local sockets.
    let inFlight = 0
    let peak = 0

    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1

      return new URL(url).pathname.includes('movie_credits')
        ? new Response(
            JSON.stringify({
              cast: Array.from({ length: 60 }, (_, index) => ({
                id: index,
                title: `Film ${index}`,
                release_date: PAST,
                genre_ids: [28],
              })),
            }),
          )
        : new Response(JSON.stringify({ runtime: 100 }))
    })

    const items = await createTmdbAdapter(credentials, fetchImpl).expand('person:1')

    expect(items).toHaveLength(60)
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('does not import films released after today', async () => {
    const adapter = createTmdbAdapter(
      credentials,
      router({
        '/person/1/movie_credits': {
          cast: [{ id: 1, title: 'Out Today', release_date: TODAY, genre_ids: [28] }],
        },
        '/movie/1': { runtime: 90 },
      }),
    )

    // Released *today* still counts — the cutoff is inclusive.
    expect(await adapter.expand('person:1')).toHaveLength(1)
  })
})

describe('credential timing', () => {
  /**
   * Regression: the registry is built while modules are imported, before the
   * entry point loads `.env`. Capturing credentials at construction made a
   * configured key look missing, and movies silently had no search. Every
   * mocked test passed — only a live run caught it.
   */
  it('sees a key that appears after the adapter was built', () => {
    delete process.env['DULDULATOR_TMDB_TEST_KEY']

    const adapter = createTmdbAdapter(() => ({
      apiKey: process.env['DULDULATOR_TMDB_TEST_KEY'],
      readAccessToken: undefined,
    }))

    expect(adapter.isAvailable()).toBe(false)

    process.env['DULDULATOR_TMDB_TEST_KEY'] = 'loaded-later'
    expect(adapter.isAvailable()).toBe(true)

    delete process.env['DULDULATOR_TMDB_TEST_KEY']
  })

  it('still accepts credentials passed directly', () => {
    expect(createTmdbAdapter({ apiKey: 'k', readAccessToken: undefined }).isAvailable()).toBe(true)
  })
})
