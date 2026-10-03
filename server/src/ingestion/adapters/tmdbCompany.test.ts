import { describe, expect, it, vi } from 'vitest'
import { expandWithRuntimes } from '../expansion.js'
import type { FetchLike } from '../http.js'
import { createTmdbCompanyAdapter } from './tmdbCompany.js'

const credentials = { apiKey: 'test-key', readAccessToken: undefined }

function router(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace('/3', '')
    const body = routes[path]

    return body === undefined
      ? new Response('{"status_message":"Not found"}', { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 })
  })
}

const routes = {
  '/discover/movie': {
    total_pages: 1,
    results: [
      { id: 862, title: 'Toy Story', release_date: '1995-11-22' },
      { id: 12, title: 'Finding Nemo', release_date: '2003-05-30' },
      { id: 1, title: 'Announced', release_date: '2099-01-01' },
    ],
  },
  '/movie/862': { runtime: 81 },
  '/movie/12': { runtime: 100 },
}

const paths = (fetchImpl: FetchLike): string[] =>
  vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).pathname.replace('/3', ''))

describe('TMDB studio expansion', () => {
  it('lists a studio’s released films with their runtimes by default', async () => {
    const { items } = await createTmdbCompanyAdapter(credentials, {}, router(routes)).expand('company:3')

    expect(items).toEqual([
      { title: 'Toy Story', externalRef: 'movie:862', timeToConsumeMinutes: 81, year: 1995 },
      { title: 'Finding Nemo', externalRef: 'movie:12', timeToConsumeMinutes: 100, year: 2003 },
    ])
  })

  it('lists them without a /movie request and without a length when asked to skip runtimes (15.2)', async () => {
    const fetchImpl = router(routes)
    const { items } = await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', {
      runtimes: 'skip',
    })

    expect(items).toEqual([
      { title: 'Toy Story', externalRef: 'movie:862', year: 1995 },
      { title: 'Finding Nemo', externalRef: 'movie:12', year: 2003 },
    ])
    expect(paths(fetchImpl).filter((path) => path.startsWith('/movie/'))).toEqual([])
  })

  it('skip then enrich gives exactly the full expansion', async () => {
    const adapter = createTmdbCompanyAdapter(credentials, {}, router(routes))

    expect(await expandWithRuntimes(adapter, 'company:3')).toEqual(await adapter.expand('company:3'))
  })

  it('says which kind of ref it can enrich', () => {
    expect(createTmdbCompanyAdapter(credentials).enrichPrefixes).toEqual(['movie'])
  })

  it('enriches the movie refs it listed', async () => {
    const adapter = createTmdbCompanyAdapter(credentials, {}, router(routes))

    expect(await adapter.enrich!(['movie:862'])).toEqual(
      new Map([['movie:862', { status: 'found', minutes: 81 }]]),
    )
  })

  it('refuses refs that are not a numeric company id', async () => {
    const fetchImpl = router(routes)

    expect((await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:../x')).items).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('TMDB studio paging without a cap (15.9)', () => {
  /** A studio of `pages` discover pages: 20 released films each, ids unique, oldest first across pages. */
  function studio(pages: number) {
    let inFlight = 0
    let peak = 0
    const requested: number[] = []
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const target = new URL(url)
      if (target.pathname !== '/3/discover/movie') return new Response('{}', { status: 404 })

      const page = Number(target.searchParams.get('page'))
      requested.push(page)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1

      return new Response(
        JSON.stringify({
          total_pages: pages,
          results: Array.from({ length: 20 }, (_, index) => ({ id: page * 100 + index, title: `P${page} F${index}`, release_date: '2001-01-01' })),
        }),
        { status: 200 },
      )
    })

    return { fetchImpl, requested, peak: () => peak }
  }

  it('lists every page the studio has, not the first five', async () => {
    const { fetchImpl, requested } = studio(12)

    const { items } = await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(items).toHaveLength(12 * 20)
    expect([...requested].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  })

  it('keeps the pages in order, whichever answered first', async () => {
    const { fetchImpl } = studio(9)

    const { items } = await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(items.map((item) => item.title).slice(0, 2)).toEqual(['P1 F0', 'P1 F1'])
    expect(items.map((item) => Number(item.title.split(' ')[0]!.slice(1)))).toEqual([...items.map((item) => Number(item.title.split(' ')[0]!.slice(1)))].sort((a, b) => a - b))
  })

  it('asks for the pages after the first eight at a time, not one after another and not all at once', async () => {
    const { fetchImpl, peak } = studio(40)

    await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(peak()).toBeGreaterThan(1)
    expect(peak()).toBeLessThanOrEqual(8)
  })

  it('stops where TMDB itself stops: it serves no page past 500', async () => {
    const { fetchImpl, requested } = studio(600)

    const { items } = await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(Math.max(...requested)).toBe(500)
    expect(items).toHaveLength(500 * 20)
  })
})

describe('TMDB studio lists leave documentaries to the Documentaries shelf (owner, 2026-10-03)', () => {
  /** Records the query of every discover request. */
  function recording() {
    const queries: URLSearchParams[] = []
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const target = new URL(url)
      if (target.pathname === '/3/discover/movie') queries.push(target.searchParams)

      return new Response(JSON.stringify({ total_pages: 1, results: [{ id: 1, title: 'Toy Story', release_date: '1995-11-22' }] }), { status: 200 })
    })

    return { fetchImpl, queries }
  }

  it('asks TMDB to leave documentaries out, so the pages and the count are exact', async () => {
    const { fetchImpl, queries } = recording()

    await createTmdbCompanyAdapter(credentials, {}, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(queries.map((query) => query.get('without_genres'))).toEqual(['99'])
  })

  it('does so together with a genre a shelf keeps to', async () => {
    const { fetchImpl, queries } = recording()

    await createTmdbCompanyAdapter(credentials, { genreFilter: 16 }, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(queries[0]?.get('with_genres')).toBe('16')
    expect(queries[0]?.get('without_genres')).toBe('99')
  })

  it('can keep only them: the Documentaries shelf lists a studio’s documentaries', async () => {
    const { fetchImpl, queries } = recording()

    await createTmdbCompanyAdapter(credentials, { documentaries: 'only' }, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(queries[0]?.get('with_genres')).toBe('99')
    expect(queries[0]?.has('without_genres')).toBe(false)
  })

  it('can keep them: a shelf that keeps to one genre already says what belongs (Animation)', async () => {
    const { fetchImpl, queries } = recording()

    await createTmdbCompanyAdapter(credentials, { genreFilter: 16, documentaries: 'include' }, fetchImpl).expand('company:3', { runtimes: 'skip' })

    expect(queries[0]?.get('with_genres')).toBe('16')
    expect(queries[0]?.has('without_genres')).toBe(false)
  })
})

describe('a scoped studio search offers only studios with something to list (BL-052)', () => {
  /** Studio 3 has an animated film out, 4 none, 5 only an unreleased one; 6 cannot be checked. */
  function studios() {
    const asked: URLSearchParams[] = []
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const target = new URL(url)
      if (target.pathname === '/3/search/company') {
        return new Response(
          JSON.stringify({ results: [3, 4, 5, 6].map((id) => ({ id, name: `Studio ${id}`, origin_country: 'US' })) }),
        )
      }
      if (target.pathname === '/3/discover/movie') {
        asked.push(target.searchParams)
        const company = target.searchParams.get('with_companies')
        if (company === '6') throw new TypeError('fetch failed')
        const results =
          company === '3'
            ? [{ id: 1, title: 'Old', release_date: '1995-11-22' }]
            : company === '5'
              ? [{ id: 2, title: 'Announced', release_date: '2099-01-01' }]
              : []

        return new Response(JSON.stringify({ total_pages: 1, total_results: results.length, results }))
      }

      return new Response('{}', { status: 404 })
    })

    return { fetchImpl, asked }
  }
  const offered = async (adapter: ReturnType<typeof createTmdbCompanyAdapter>) =>
    (await adapter.search('x')).map((source) => source.externalRef)

  it('drops a studio with no released animated film, and keeps one that could not be checked', async () => {
    const { fetchImpl } = studios()

    expect(await offered(createTmdbCompanyAdapter(credentials, { genreFilter: 16, documentaries: 'include' }, fetchImpl))).toEqual([
      'company:3',
      'company:6',
    ])
  })

  it('asks for the first page only, with the shelf’s own genre, as the list itself would', async () => {
    const { fetchImpl, asked } = studios()
    await createTmdbCompanyAdapter(credentials, { genreFilter: 16, documentaries: 'include' }, fetchImpl).search('x')

    // (A dropped connection is tried once more by the client, so studio 6 is asked twice.)
    expect([...new Set(asked.map((query) => query.get('with_companies')))].sort()).toEqual(['3', '4', '5', '6'])
    expect(asked.every((query) => query.get('with_genres') === '16' && query.get('page') === '1')).toBe(true)
  })

  it('applies to the Documentaries shelf: only studios with a documentary', async () => {
    const { fetchImpl, asked } = studios()
    const found = await offered(createTmdbCompanyAdapter(credentials, { documentaries: 'only' }, fetchImpl))

    expect(found).toEqual(['company:3', 'company:6'])
    expect(asked.every((query) => query.get('with_genres') === '99')).toBe(true)
  })

  it('leaves an unscoped search alone: Movies makes no extra request', async () => {
    const { fetchImpl, asked } = studios()

    expect(await offered(createTmdbCompanyAdapter(credentials, {}, fetchImpl))).toEqual(['company:3', 'company:4', 'company:5', 'company:6'])
    expect(asked).toEqual([])
  })
})
