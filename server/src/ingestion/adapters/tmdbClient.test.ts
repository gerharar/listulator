import { describe, expect, it, vi } from 'vitest'
import { UnauthorizedError, UpstreamError, type FetchLike } from '../http.js'
import { createPacer, type RateLimiter } from '../rateLimiter.js'
import { createTmdbClient, tmdbRequestLimiter } from './tmdb.js'

const credentials = { apiKey: 'test-key', readAccessToken: undefined }

/** Answers each call with the next response in the list; the last one repeats. */
function sequence(...responses: (() => Response)[]): FetchLike & ReturnType<typeof vi.fn> {
  let call = 0

  return vi.fn(async () => responses[Math.min(call++, responses.length - 1)]!())
}

const ok = () => new Response('{"ok":true}', { status: 200 })
const status = (code: number, headers: Record<string, string> = {}) => () =>
  new Response('{"status_message":"nope"}', { status: code, headers })

function clientWith(fetchImpl: FetchLike) {
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)

  return { client: createTmdbClient(credentials, fetchImpl, { sleep }), sleep }
}

describe('TMDB client retries', () => {
  it('waits the Retry-After a 429 asks for, then succeeds', async () => {
    const fetchImpl = sequence(status(429, { 'retry-after': '2' }), ok)
    const { client, sleep } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).resolves.toEqual({ ok: true })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2000)
  })

  it('backs off on a 5xx with no Retry-After, then succeeds', async () => {
    const fetchImpl = sequence(status(500), ok)
    const { client, sleep } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).resolves.toEqual({ ok: true })

    expect(sleep).toHaveBeenCalledExactlyOnceWith(500)
  })

  it('gives up after three 503s with an error that names the source', async () => {
    const fetchImpl = sequence(status(503))
    const { client, sleep } = clientWith(fetchImpl)

    const error = await client.request('/movie/1').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(UpstreamError)
    expect(error).toMatchObject({ status: 503 })
    expect((error as Error).message).toMatch(/^TMDB returned 503/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000])
  })

  it('does not wait out a Retry-After longer than a build should stall for', async () => {
    const fetchImpl = sequence(status(429, { 'retry-after': '120' }), ok)
    const { client, sleep } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).rejects.toMatchObject({ status: 429 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry a 404: it is an answer, not a failure', async () => {
    const fetchImpl = sequence(status(404), ok)
    const { client, sleep } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).rejects.toMatchObject({ status: 404 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry rejected credentials', async () => {
    const fetchImpl = sequence(status(401), ok)
    const { client } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).rejects.toBeInstanceOf(UnauthorizedError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not retry an upstream that could not be reached', async () => {
    const fetchImpl: FetchLike & ReturnType<typeof vi.fn> = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const { client } = clientWith(fetchImpl)

    await expect(client.request('/movie/1')).rejects.toThrow(/Could not reach TMDB/)
    // `getJson` itself tries once more without the User-Agent; the client adds no retry on top.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('TMDB client mapLimited', () => {
  it('stops taking new items once one fails, rather than finishing a doomed run', async () => {
    const { client } = clientWith(sequence(ok))
    const started: number[] = []

    const run = client.mapLimited([1, 2, 3, 4, 5, 6, 7, 8], 2, async (item) => {
      started.push(item)
      await Promise.resolve()
      if (item === 2) throw new Error('boom')
      return item
    })

    await expect(run).rejects.toThrow('boom')
    // Let the other worker drain whatever it was in the middle of.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(started.length).toBeLessThan(8)
  })

  it('still returns every result in order when nothing fails', async () => {
    const { client } = clientWith(sequence(ok))

    expect(await client.mapLimited([1, 2, 3, 4], 2, async (item) => item * 10)).toEqual([10, 20, 30, 40])
  })
})

describe('the TMDB request budget, shared by every request that goes to TMDB (15.9)', () => {
  it('spaces the requests of two clients that share one limiter, as the listing and the runner do', async () => {
    let clock = 0
    const waits: number[] = []
    // Sleeps that end at times of their own, side by side; the clock only moves forward.
    const sleep = (ms: number) => {
      const until = clock + ms
      waits.push(ms)

      return Promise.resolve().then(() => void (clock = Math.max(clock, until)))
    }
    const limiter = createPacer(25, { now: () => clock, sleep })
    const fetchImpl = sequence(ok)
    const listing = createTmdbClient(credentials, fetchImpl, { limiter })
    const runner = createTmdbClient(credentials, fetchImpl, { limiter })

    await Promise.all([listing.request('/discover/movie'), runner.request('/movie/1'), listing.request('/discover/movie'), runner.request('/movie/2')])

    expect(fetchImpl).toHaveBeenCalledTimes(4)
    // One request starts at once; the others take the next slots, 25 ms apart.
    expect(waits).toEqual([25, 50, 75])
  })

  it('puts every attempt through it, a retry included', async () => {
    const run = vi.fn((fn: () => Promise<unknown>) => fn())
    const fetchImpl = sequence(status(503), ok)
    const client = createTmdbClient(credentials, fetchImpl, { sleep: async () => undefined, limiter: { run: run as RateLimiter['run'] } })

    await client.request('/movie/1')

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('is the one shared limiter for a client that talks to the real TMDB, and no limiter for one given a fake fetch', async () => {
    const shared = vi.spyOn(tmdbRequestLimiter, 'run')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })))

    try {
      await createTmdbClient(credentials, sequence(ok)).request('/movie/1')
      expect(shared).not.toHaveBeenCalled()

      await createTmdbClient(credentials).request('/movie/1')
      expect(shared).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      shared.mockRestore()
    }
  })
})

