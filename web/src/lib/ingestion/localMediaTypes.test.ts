import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { comicVineRequestLimiter } from '../../../../server/src/ingestion/adapters/comicVine.js'
import { igdbRequestLimiter } from '../../../../server/src/ingestion/adapters/igdb.js'
import { musicBrainzRequestLimiter } from '../../../../server/src/ingestion/adapters/musicbrainz.js'
import type { RateLimiter } from '../../../../server/src/ingestion/rateLimiter.js'

let saved: { tmdbApiKey?: string } = {}

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))
vi.mock('../config/localConfig.js', () => ({ getLocalSettings: vi.fn(async () => saved) }))

import { getLocalMediaTypes, LOCAL_FETCHERS, pacedFetch, resetLocalMediaTypes } from './localMediaTypes.js'

const movieAvailable = async () =>
  (await getLocalMediaTypes()).find((entry) => entry.key === 'movie')?.adapter?.isAvailable() ?? false

beforeEach(() => {
  saved = {}
  resetLocalMediaTypes()
})

describe('local media types', () => {
  it('reads the keys once and keeps that registry for the session', async () => {
    expect(await movieAvailable()).toBe(false)

    saved = { tmdbApiKey: 'abc123' }

    expect(await movieAvailable()).toBe(false)
  })

  it('after a reset, reads the keys as they are now — a key saved in Settings works at once', async () => {
    expect(await movieAvailable()).toBe(false)

    saved = { tmdbApiKey: 'abc123' }
    resetLocalMediaTypes()

    expect(await movieAvailable()).toBe(true)
  })
})

/**
 * BL-080: the adapters keep their shared request line only when they are not given a `fetch` of their own, and the
 * desktop always gives MusicBrainz, IGDB and Comic Vine the Rust plugin's. So the line has to be here: a search followed
 * at once by a Preview sent MusicBrainz two requests together, and it answered 503.
 */
describe('the desktop connectors that go through the Rust plugin keep their request line (BL-080)', () => {
  const answer = () => new Response('{}')

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.mocked(tauriFetch).mockReset()
  })

  it('pacedFetch sends the request through the line, with the same address and options, and returns the answer', async () => {
    const run = vi.fn((fn: () => Promise<unknown>) => fn())
    const limiter: RateLimiter = { run: run as RateLimiter['run'] }
    const inner = vi.fn(async () => answer())
    const init = { method: 'POST', body: 'x' }

    const response = await pacedFetch(limiter, inner)('https://example.test/a', init)

    expect(run).toHaveBeenCalledTimes(1)
    expect(inner).toHaveBeenCalledWith('https://example.test/a', init)
    expect(response).toBeInstanceOf(Response)
  })

  it('pacedFetch passes a failure on, and the next request still goes through', async () => {
    const limiter: RateLimiter = { run: (fn) => fn() }
    const inner = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(answer())
    const paced = pacedFetch(limiter, inner)

    await expect(paced('https://example.test/a')).rejects.toThrow('offline')
    await expect(paced('https://example.test/b')).resolves.toBeInstanceOf(Response)
  })

  it.each([
    ['musicbrainz', musicBrainzRequestLimiter],
    ['igdb', igdbRequestLimiter],
    ['comicVine', comicVineRequestLimiter],
  ] as const)('%s goes through its own shared line, once per request, to the plugin', async (key, limiter) => {
    const run = vi.spyOn(limiter, 'run')
    vi.mocked(tauriFetch).mockResolvedValue(answer())

    await LOCAL_FETCHERS[key]!('https://example.test/x', { method: 'GET' })

    expect(run).toHaveBeenCalledTimes(1)
    expect(tauriFetch).toHaveBeenCalledWith('https://example.test/x', { method: 'GET' })
  })

  it('no connector shares another connector’s line', async () => {
    const others = [igdbRequestLimiter, comicVineRequestLimiter].map((limiter) => vi.spyOn(limiter, 'run'))
    vi.mocked(tauriFetch).mockResolvedValue(answer())

    await LOCAL_FETCHERS.musicbrainz!('https://example.test/x')

    for (const run of others) expect(run).not.toHaveBeenCalled()
  })

  it('two MusicBrainz requests sent together reach the plugin at least a second apart, the first at once', async () => {
    vi.useFakeTimers()
    const startedAt: number[] = []
    vi.mocked(tauriFetch).mockImplementation(async () => {
      startedAt.push(Date.now())
      return answer()
    })
    // Let anything an earlier test put in the shared line pass first.
    await vi.advanceTimersByTimeAsync(5_000)

    const search = LOCAL_FETCHERS.musicbrainz!('https://example.test/search')
    const preview = LOCAL_FETCHERS.musicbrainz!('https://example.test/preview')
    await vi.advanceTimersByTimeAsync(0)

    expect(startedAt).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([search, preview])

    expect(startedAt).toHaveLength(2)
    expect(startedAt[1]! - startedAt[0]!).toBeGreaterThanOrEqual(1_000)
  })

  it('a request that fails does not hold up the one behind it', async () => {
    vi.useFakeTimers()
    vi.mocked(tauriFetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(answer())
    await vi.advanceTimersByTimeAsync(5_000)

    const first = LOCAL_FETCHERS.musicbrainz!('https://example.test/a')
    const second = LOCAL_FETCHERS.musicbrainz!('https://example.test/b')
    const failed = expect(first).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(5_000)

    await failed
    await expect(second).resolves.toBeInstanceOf(Response)
  })
})
