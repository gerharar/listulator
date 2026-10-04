import { describe, expect, it, vi } from 'vitest'
import {
  getJson,
  IngestionError,
  parseRetryAfter,
  UnauthorizedError,
  UpstreamError,
  withRetries,
  type FetchLike,
} from './http.js'

const answer = (status: number, headers: Record<string, string> = {}, body = '{}'): FetchLike =>
  async () => new Response(body, { status, headers })

async function failure(fetchImpl: FetchLike): Promise<unknown> {
  return await getJson('https://example.test/x', { source: 'Example', fetchImpl }).then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('parseRetryAfter', () => {
  it('reads a number of seconds as milliseconds', () => {
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('reads an HTTP date as the wait from now, never negative', () => {
    const now = Date.parse('2026-10-03T12:00:00Z')

    expect(parseRetryAfter('Sat, 03 Oct 2026 12:00:07 GMT', now)).toBe(7000)
    expect(parseRetryAfter('Sat, 03 Oct 2026 11:59:00 GMT', now)).toBe(0)
  })

  it('is undefined for a missing or unreadable header', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter('-3')).toBeUndefined()
  })
})

describe('getJson upstream errors', () => {
  it('throws an UpstreamError carrying the status and Retry-After for a 429', async () => {
    const error = await failure(answer(429, { 'retry-after': '3' }))

    expect(error).toBeInstanceOf(UpstreamError)
    expect(error).toMatchObject({ status: 429, retryAfterMs: 3000 })
    expect((error as Error).message).toBe('Example is rate-limiting us. Try again in a moment.')
  })

  it('carries the status of a failing response and keeps its message', async () => {
    const error = await failure(answer(503, {}, JSON.stringify({ error: { message: 'down' } })))

    expect(error).toBeInstanceOf(UpstreamError)
    expect(error).toMatchObject({ status: 503, retryAfterMs: undefined })
    expect((error as Error).message).toBe('Example returned 503: down')
  })

  it('carries a 404 as a status too, so a caller can tell "not there" from "broken"', async () => {
    expect(await failure(answer(404))).toMatchObject({ status: 404 })
  })

  it('is still an IngestionError, so the routes keep answering it as before', async () => {
    expect(await failure(answer(500))).toBeInstanceOf(IngestionError)
  })

  it('leaves rejected credentials as an UnauthorizedError', async () => {
    const error = await failure(answer(401))

    expect(error).toBeInstanceOf(UnauthorizedError)
    expect(error).not.toBeInstanceOf(UpstreamError)
  })

  // Google's APIs answer a used-up quota, a rate limit and a refused key all with 403, told apart only by the
  // `reason` in the body (YouTube, documented). Read as "rejected our credentials", a spent daily quota would
  // tell the owner their key is bad.
  const google403 = (reason: string): FetchLike =>
    answer(403, {}, JSON.stringify({ error: { code: 403, message: 'x', errors: [{ reason }] } }))

  it('reads a Google 403 for a spent quota as the quota, not as bad credentials', async () => {
    for (const reason of ['quotaExceeded', 'dailyLimitExceeded']) {
      const error = await failure(google403(reason))

      expect(error).toBeInstanceOf(UpstreamError)
      expect(error).not.toBeInstanceOf(UnauthorizedError)
      expect(error).toMatchObject({ status: 403 })
      expect((error as Error).message).toBe(
        "Example's daily quota is used up. It resets at midnight Pacific Time.",
      )
    }
  })

  it('reads a Google 403 for a rate limit as a 429, so a caller retries it', async () => {
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'concurrentLimitExceeded']) {
      const error = await failure(google403(reason))

      expect(error).toBeInstanceOf(UpstreamError)
      expect(error).toMatchObject({ status: 429 })
      expect((error as Error).message).toBe('Example is rate-limiting us. Try again in a moment.')
    }
  })

  it('names the reason of any other Google 403 and keeps it an UnauthorizedError', async () => {
    const error = await failure(google403('forbidden'))

    expect(error).toBeInstanceOf(UnauthorizedError)
    expect((error as Error).message).toBe('Example rejected our credentials (forbidden).')
  })

  it('leaves a 403 that is not shaped like Google’s as it was', async () => {
    for (const body of [
      '{}',
      'forbidden',
      JSON.stringify({ error: { message: 'no' } }),
      JSON.stringify({ error: { errors: [{ reason: 5 }] } }),
    ]) {
      const error = await failure(answer(403, {}, body))

      expect(error).toBeInstanceOf(UnauthorizedError)
      expect((error as Error).message).toBe('Example rejected our credentials.')
    }
  })

  it('has no status when the upstream could not be reached at all', async () => {
    const error = await failure(async () => {
      throw new TypeError('fetch failed')
    })

    expect(error).toBeInstanceOf(IngestionError)
    expect(error).not.toBeInstanceOf(UpstreamError)
  })
})

describe('the timeout', () => {
  /**
   * Headers at once, then a body that never ends: what an upstream that stalls mid-answer looks like. Like a real
   * `fetch`, the body fails when the request's signal is aborted, and only then.
   */
  const stallsAfterHeaders: FetchLike = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'))
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        },
      }),
      { status: 200 },
    )

  it('covers reading the body too: a stalled answer fails as timed out instead of waiting for ever', async () => {
    // Review 2026-10-04: the timer stopped when the headers came, so a stalled body held a one-at-a-time queue
    // (MusicBrainz, Comic Vine, Open Library) for as long as the platform's own limit, or for ever.
    const error = await getJson('https://example.test/x', { source: 'Example', fetchImpl: stallsAfterHeaders, timeoutMs: 50 }).then(
      () => undefined,
      (cause: unknown) => cause,
    )

    expect(error).toBeInstanceOf(IngestionError)
    expect((error as Error).message).toBe('Could not reach Example (timed out).')
  })

  it('still says "not JSON" for a body that ended and was not JSON', async () => {
    const error = await failure(answer(200, {}, 'not json'))

    expect((error as Error).message).toBe('Example returned something that was not JSON.')
  })
})

describe('withRetries', () => {
  const noWait = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const failing = (...errors: unknown[]) => {
    const pending = [...errors]

    return vi.fn(async () => {
      if (pending.length > 0) throw pending.shift()

      return 'answer'
    })
  }

  it('returns the answer of the first try without waiting', async () => {
    noWait.mockClear()

    expect(await withRetries(failing(), noWait)).toBe('answer')
    expect(noWait).not.toHaveBeenCalled()
  })

  it('tries a 429 or a 5xx again, doubling the wait from 500 ms', async () => {
    noWait.mockClear()
    const attempt = failing(new UpstreamError('x', 503), new UpstreamError('x', 429))

    expect(await withRetries(attempt, noWait)).toBe('answer')
    expect(noWait.mock.calls.map(([ms]) => ms)).toEqual([500, 1000])
  })

  it('waits what Retry-After names, up to ten seconds and not beyond', async () => {
    noWait.mockClear()
    expect(await withRetries(failing(new UpstreamError('x', 429, 10_000)), noWait)).toBe('answer')
    expect(noWait).toHaveBeenLastCalledWith(10_000)

    noWait.mockClear()
    const refused = new UpstreamError('x', 429, 10_001)
    await expect(withRetries(failing(refused), noWait)).rejects.toBe(refused)
    expect(noWait).not.toHaveBeenCalled()
  })

  it('gives up after three tries with the last error', async () => {
    const last = new UpstreamError('last', 500)
    const attempt = failing(new UpstreamError('a', 500), new UpstreamError('b', 500), last)

    await expect(withRetries(attempt, noWait)).rejects.toBe(last)
    expect(attempt).toHaveBeenCalledTimes(3)
  })

  it('does not try again what will not mend: a 400, a 404, rejected credentials, a dead network, any other error', async () => {
    for (const error of [
      new UpstreamError('x', 400),
      new UpstreamError('x', 404),
      new UnauthorizedError('x'),
      new IngestionError('Could not reach X.'),
      new TypeError('boom'),
    ]) {
      const attempt = failing(error)

      await expect(withRetries(attempt, noWait)).rejects.toBe(error)
      expect(attempt).toHaveBeenCalledTimes(1)
    }
  })
})
