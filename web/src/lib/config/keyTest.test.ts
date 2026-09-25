import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialsFor, testKey } from './keyTest.js'

interface Call {
  url: string
  headers: Record<string, string>
}

/** A fake network: `answer` sees each request and returns the response (or throws). */
function network(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    return answer(url)
  }
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('credentialsFor', () => {
  it('sends a TMDB read access token as a bearer token and a short key as api_key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln'

    expect(credentialsFor({ tmdbApiKey: jwt }).tmdb()).toEqual({ apiKey: undefined, readAccessToken: jwt })
    expect(credentialsFor({ tmdbApiKey: 'abc123' }).tmdb()).toEqual({ apiKey: 'abc123', readAccessToken: undefined })
  })

  it('trims whitespace pasted around a key', () => {
    expect(credentialsFor({ comicVineApiKey: '  k  ' }).comicVine()).toEqual({ apiKey: 'k' })
  })
})

afterEach(() => vi.unstubAllGlobals())

/** TMDB and YouTube go through the global `fetch`; IGDB and Comic Vine take one by injection. */
function viaGlobal(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): Record<string, never> {
  vi.stubGlobal('fetch', fetchImpl)
  return {}
}

describe('testKey', () => {
  it('TMDB: an answer means the key works', async () => {
    const { fetchImpl } = network(() => json({ results: [] }))

    expect(await testKey('tmdb', { tmdbApiKey: 'abc123' }, viaGlobal(fetchImpl))).toBe('working')
  })

  it('TMDB: sends the key upstream, and the read access token as a bearer header', async () => {
    const plain = network(() => json({ results: [] }))
    await testKey('tmdb', { tmdbApiKey: 'abc123' }, viaGlobal(plain.fetchImpl))
    expect(plain.calls[0]?.url).toContain('api_key=abc123')

    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln'
    const bearer = network(() => json({ results: [] }))
    await testKey('tmdb', { tmdbApiKey: jwt }, viaGlobal(bearer.fetchImpl))
    expect(bearer.calls[0]?.headers['authorization']).toBe(`Bearer ${jwt}`)
    expect(bearer.calls[0]?.url).not.toContain('api_key')
  })

  it('TMDB: a 401 is rejected', async () => {
    const { fetchImpl } = network(() => json({ status_message: 'Invalid API key' }, 401))

    expect(await testKey('tmdb', { tmdbApiKey: 'nope' }, viaGlobal(fetchImpl))).toBe('rejected')
  })

  it('IGDB: a good id and secret work, and both are needed', async () => {
    const good = network((url) => (url.includes('twitch') ? json({ access_token: 't', expires_in: 3600 }) : json([])))
    expect(await testKey('igdb', { igdbClientId: 'id', igdbClientSecret: 's' }, { igdb: good.fetchImpl })).toBe('working')

    const none = network(() => json([]))
    expect(await testKey('igdb', { igdbClientId: 'id' }, { igdb: none.fetchImpl })).toBe('rejected')
    expect(none.calls).toHaveLength(0)
  })

  it('IGDB: Twitch refusing the pair is rejected', async () => {
    const { fetchImpl } = network(() => json({ status: 400, message: 'invalid client' }, 400))

    expect(await testKey('igdb', { igdbClientId: 'id', igdbClientSecret: 'bad' }, { igdb: fetchImpl })).toBe('rejected')
  })

  it('Comic Vine: reads a bad key from the body, since it answers 200 either way', async () => {
    const bad = network(() => json({ status_code: 100, error: 'Invalid API Key', results: [] }))
    expect(await testKey('comicVine', { comicVineApiKey: 'x' }, { comicVine: bad.fetchImpl })).toBe('rejected')

    const good = network(() => json({ status_code: 1, error: 'OK', results: [] }))
    expect(await testKey('comicVine', { comicVineApiKey: 'x' }, { comicVine: good.fetchImpl })).toBe('working')
  })

  it('YouTube: a 400 saying the key is not valid is rejected, an answer works', async () => {
    const bad = network(() => json({ error: { message: 'API key not valid. Please pass a valid API key.' } }, 400))
    expect(await testKey('youtube', { youtubeApiKey: 'x' }, viaGlobal(bad.fetchImpl))).toBe('rejected')

    const good = network(() => json({ items: [] }))
    expect(await testKey('youtube', { youtubeApiKey: 'x' }, viaGlobal(good.fetchImpl))).toBe('working')
  })

  it('a dead network is unreachable, not rejected', async () => {
    const { fetchImpl } = network(() => {
      throw new TypeError('Failed to fetch')
    })

    expect(await testKey('tmdb', { tmdbApiKey: 'abc123' }, viaGlobal(fetchImpl))).toBe('unreachable')
  })

  it('any other upstream trouble is failed — the key is not blamed', async () => {
    const { fetchImpl } = network(() => json({ message: 'boom' }, 500))

    expect(await testKey('tmdb', { tmdbApiKey: 'abc123' }, viaGlobal(fetchImpl))).toBe('failed')
  })

  it('a blank key is rejected without a request', async () => {
    const { calls, fetchImpl } = network(() => json({}))

    expect(await testKey('tmdb', { tmdbApiKey: '   ' }, viaGlobal(fetchImpl))).toBe('rejected')
    expect(calls).toHaveLength(0)
  })
})
