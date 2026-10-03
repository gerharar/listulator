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
