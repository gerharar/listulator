import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { expandWithRuntimes } from '../expansion.js'
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
    await createTmdbAdapter(credentials, {}, fetchImpl).search('x')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain('api_key=test-key')
  })

  it('prefers the v4 token as a bearer header, and keeps the key out of the URL', async () => {
    const fetchImpl = router({ '/search/person': {}, '/search/collection': {} })
    await createTmdbAdapter({ apiKey: 'k', readAccessToken: 'token' }, {}, fetchImpl).search('x')

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
    const adapter = createTmdbAdapter(credentials, {}, router(routes))

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
    const adapter = createTmdbAdapter(credentials, {}, router(routes))
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
    const adapter = createTmdbAdapter(credentials, {}, router(routes))

    expect((await adapter.expand('person:18897')).items).toEqual([
      { title: 'My Lucky Stars', externalRef: 'movie:10044', timeToConsumeMinutes: 96, year: 1985 },
      { title: 'Rush Hour', externalRef: 'movie:2109', timeToConsumeMinutes: 97, year: 1998 },
    ])
  })

  it('drops documentaries, unreleased films and undated entries', async () => {
    // A filmography padded with a documentary about the person, and with
    // films that do not exist yet, is not a thing you can finish.
    const adapter = createTmdbAdapter(credentials, {}, router(routes))
    const titles = (await adapter.expand('person:18897')).items.map((item) => item.title)

    expect(titles).not.toContain('A Documentary About Stunts')
    expect(titles).not.toContain('Untitled Sequel')
    expect(titles).not.toContain('No Date At All')
  })

  it('keeps the rest when one film’s details fail', async () => {
    // 404 on one lookup should cost that film its runtime, not lose the list.
    const adapter = createTmdbAdapter(credentials, {}, router({ ...routes, '/movie/2109': undefined }))

    const items = (await adapter.expand('person:18897')).items
    expect(items).toHaveLength(2)
    expect(items.find((item) => item.title === 'Rush Hour')?.timeToConsumeMinutes).toBeUndefined()
  })

  it('expands a collection the same way', async () => {
    const adapter = createTmdbAdapter(
      credentials,
      {},
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

    expect((await adapter.expand('collection:645')).items.map((item) => item.title)).toEqual([
      'My Lucky Stars',
      'Rush Hour',
    ])
  })

  it('returns nothing for a ref it does not understand', async () => {
    const adapter = createTmdbAdapter(credentials, {}, router({}))

    expect((await adapter.expand('nonsense')).items).toEqual([])
  })

  it('refuses a person or collection id that is not a number, without asking TMDB anything', async () => {
    // The id goes straight into the request path, where `../` would walk to another endpoint
    // (with the owner's key). The company, franchise and TV adapters already refuse these.
    const fetchImpl = router({})
    const adapter = createTmdbAdapter(credentials, {}, fetchImpl)

    for (const ref of ['person:1/../../account', 'person:abc', 'person:', 'collection:1?x=y', 'collection:../x']) {
      expect((await adapter.expand(ref)).items, ref).toEqual([])
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('handles a person with no credits', async () => {
    const adapter = createTmdbAdapter(credentials, {}, router({ '/person/1/movie_credits': {} }))

    expect((await adapter.expand('person:1')).items).toEqual([])
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

    const items = (await createTmdbAdapter(credentials, {}, fetchImpl).expand('person:1')).items

    expect(items).toHaveLength(60)
    expect(peak).toBeLessThanOrEqual(8)
  })

  it('does not import films released after today', async () => {
    const adapter = createTmdbAdapter(
      credentials,
      {},
      router({
        '/person/1/movie_credits': {
          cast: [{ id: 1, title: 'Out Today', release_date: TODAY, genre_ids: [28] }],
        },
        '/movie/1': { runtime: 90 },
      }),
    )

    // Released *today* still counts — the cutoff is inclusive.
    expect((await adapter.expand('person:1')).items).toHaveLength(1)
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
    delete process.env['LISTULATOR_TMDB_TEST_KEY']

    const adapter = createTmdbAdapter(() => ({
      apiKey: process.env['LISTULATOR_TMDB_TEST_KEY'],
      readAccessToken: undefined,
    }))

    expect(adapter.isAvailable()).toBe(false)

    process.env['LISTULATOR_TMDB_TEST_KEY'] = 'loaded-later'
    expect(adapter.isAvailable()).toBe(true)

    delete process.env['LISTULATOR_TMDB_TEST_KEY']
  })

  it('still accepts credentials passed directly', () => {
    expect(createTmdbAdapter({ apiKey: 'k', readAccessToken: undefined }).isAvailable()).toBe(true)
  })
})

describe('directing credits', () => {
  const CREDITS = {
    cast: [{ id: 1, title: 'Appeared In', release_date: PAST, genre_ids: [99] }],
    crew: [
      { id: 2, title: 'Directed', release_date: PAST, genre_ids: [99], job: 'Director' },
      { id: 3, title: 'Produced', release_date: PAST, genre_ids: [99], job: 'Producer' },
      // The same film can be credited twice for one person.
      { id: 1, title: 'Appeared In', release_date: PAST, genre_ids: [99], job: 'Director' },
    ],
  }

  const routes = {
    '/person/1/movie_credits': CREDITS,
    '/movie/1': { runtime: 90 },
    '/movie/2': { runtime: 100 },
    '/movie/3': { runtime: 110 },
  }

  it('reads only cast credits by default, so an actor gets the films they are in', async () => {
    const adapter = createTmdbAdapter(credentials, { documentaries: 'only' }, router(routes))

    expect((await adapter.expand('person:1')).items.map((item) => item.title)).toEqual(['Appeared In'])
  })

  it('adds directed films when asked, without other crew roles', async () => {
    // Documentarians direct rather than appear — reading cast alone found 12
    // of Ken Burns' 59 documentaries. Producing credits stay out.
    const adapter = createTmdbAdapter(
      credentials,
      { documentaries: 'only', includeDirecting: true },
      router(routes),
    )
    const titles = (await adapter.expand('person:1')).items.map((item) => item.title)

    expect(titles).toContain('Directed')
    expect(titles).not.toContain('Produced')
  })

  it('does not list a film twice when someone is credited twice on it', async () => {
    const adapter = createTmdbAdapter(
      credentials,
      { documentaries: 'only', includeDirecting: true },
      router(routes),
    )
    const titles = (await adapter.expand('person:1')).items.map((item) => item.title)

    expect(titles.filter((title) => title === 'Appeared In')).toHaveLength(1)
  })
})

describe('TMDB listing without runtimes (15.2)', () => {
  const routes = {
    '/person/18897/movie_credits': {
      cast: [
        { id: 2109, title: 'Rush Hour', release_date: PAST, genre_ids: [28] },
        { id: 10044, title: 'My Lucky Stars', release_date: '1985-02-10', genre_ids: [28] },
      ],
    },
    '/collection/645': {
      parts: [{ id: 658, title: 'Dr. No', release_date: '1962-10-05' }],
    },
    '/movie/2109': { runtime: 97 },
    '/movie/10044': { runtime: 96 },
    '/movie/658': { runtime: 110 },
  }

  const paths = (fetchImpl: FetchLike): string[] =>
    vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).pathname.replace('/3', ''))

  it.each(['person:18897', 'collection:645'])(
    'lists %s with no /movie request and no length on any item',
    async (ref) => {
      const fetchImpl = router(routes)
      const { items } = await createTmdbAdapter(credentials, {}, fetchImpl).expand(ref, { runtimes: 'skip' })

      expect(items.length).toBeGreaterThan(0)
      expect(paths(fetchImpl).filter((path) => path.startsWith('/movie/'))).toEqual([])
      for (const item of items) expect(item).not.toHaveProperty('timeToConsumeMinutes')
    },
  )

  it('lists the same films in the same order as the full expansion, with the same refs and years', async () => {
    const adapter = createTmdbAdapter(credentials, {}, router(routes))

    const listed = (await adapter.expand('person:18897', { runtimes: 'skip' })).items
    const full = (await adapter.expand('person:18897')).items

    expect(listed).toEqual(
      full.map((item) => {
        const withoutLength = { ...item }
        delete withoutLength.timeToConsumeMinutes

        return withoutLength
      }),
    )
  })

  it('still looks every runtime up by default, as before', async () => {
    const fetchImpl = router(routes)
    const { items } = await createTmdbAdapter(credentials, {}, fetchImpl).expand('person:18897')

    expect(items.map((item) => item.timeToConsumeMinutes)).toEqual([96, 97])
    expect(paths(fetchImpl)).toEqual(expect.arrayContaining(['/movie/2109', '/movie/10044']))
  })

  it('skip then enrich gives exactly the full expansion', async () => {
    const adapter = createTmdbAdapter(credentials, {}, router(routes))

    expect(await expandWithRuntimes(adapter, 'person:18897')).toEqual(await adapter.expand('person:18897'))
  })
})

describe('TMDB runtime enrichment (15.2)', () => {
  const unreachableAt = (path: string, inner: FetchLike): FetchLike => async (url, init) => {
    if (new URL(url).pathname.replace('/3', '') === path) throw new TypeError('fetch failed')

    return inner(url, init)
  }

  const routes = {
    '/movie/1': { runtime: 97 },
    '/movie/2': { runtime: 0 },
    '/movie/3': { runtime: null },
    // /movie/4 is not routed: TMDB answers 404.
  }

  it('says which kind of ref it can enrich, so a runner can find what is pending', () => {
    expect(createTmdbAdapter(credentials).enrichPrefixes).toEqual(['movie'])
  })

  it('answers found for a runtime, and none for a zero, a null and a 404 (definitive answers)', async () => {
    const adapter = createTmdbAdapter(credentials, {}, router(routes))

    const lookups = await adapter.enrich!(['movie:1', 'movie:2', 'movie:3', 'movie:4'])

    expect([...lookups]).toEqual([
      ['movie:1', { status: 'found', minutes: 97 }],
      ['movie:2', { status: 'none' }],
      ['movie:3', { status: 'none' }],
      ['movie:4', { status: 'none' }],
    ])
  })

  it('fails only the ref whose request failed, so it can be tried again later', async () => {
    const adapter = createTmdbAdapter(credentials, {}, unreachableAt('/movie/2', router({ '/movie/1': { runtime: 97 }, '/movie/3': { runtime: 50 } })))

    const lookups = await adapter.enrich!(['movie:1', 'movie:2', 'movie:3'])

    expect(lookups.get('movie:1')).toEqual({ status: 'found', minutes: 97 })
    expect(lookups.get('movie:2')).toMatchObject({ status: 'failed' })
    expect(lookups.get('movie:3')).toEqual({ status: 'found', minutes: 50 })
  })

  it('does not answer for a ref that is not a movie id, and never puts one in a request path', async () => {
    const fetchImpl = router(routes)
    const adapter = createTmdbAdapter(credentials, {}, fetchImpl)

    const lookups = await adapter.enrich!(['person:1', 'movie:../tv/5', 'movie:', 'movie:1'])

    expect([...lookups.keys()]).toEqual(['movie:1'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('asks a few at a time, not all at once', async () => {
    let inFlight = 0
    let peak = 0
    const fetchImpl: FetchLike = async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1

      return new Response('{"runtime":90}', { status: 200 })
    }

    const refs = Array.from({ length: 30 }, (_, index) => `movie:${index + 1}`)
    const lookups = await createTmdbAdapter(credentials, {}, fetchImpl).enrich!(refs)

    expect(lookups.size).toBe(30)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(8)
  })
})
