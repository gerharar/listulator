import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MAX_BYTES,
  getJson,
  getText,
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

/**
 * A response is read only up to a limit (security review, Phase 19, SR-020). Every connector and the library read a whole body
 * with `response.json()` or `.text()` and a 15 s timer only, so a huge or never-ending answer was held in memory until the timer.
 */
describe('the size limit on what is read', () => {
  /** A body of `chunks` chunks of `size` bytes, that counts how many were pulled out of it. */
  function streamed(chunks: number, size: number, init: ResponseInit = {}) {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= chunks) {
          controller.close()

          return
        }
        pulled += 1
        controller.enqueue(new Uint8Array(size).fill(97))
      },
    })

    return { fetchImpl: (async () => new Response(body, { status: 200, ...init })) as FetchLike, pulled: () => pulled }
  }

  const text = (fetchImpl: FetchLike, maxBytes?: number) =>
    getText('https://example.test/x', { source: 'Example', fetchImpl, ...(maxBytes === undefined ? {} : { maxBytes }) })
  const json = (fetchImpl: FetchLike, maxBytes?: number) =>
    getJson<unknown>('https://example.test/x', { source: 'Example', fetchImpl, ...(maxBytes === undefined ? {} : { maxBytes }) })

  it('reads a body under the limit, and one of exactly the limit', async () => {
    expect(await text(streamed(2, 500).fetchImpl, 1000)).toBe('a'.repeat(1000))
    expect(await json(answer(200, {}, '{"a":1}'), 100)).toEqual({ a: 1 })
  })

  it('refuses a body one byte over the limit, naming the source', async () => {
    const error = await text(streamed(1, 1001).fetchImpl, 1000).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(IngestionError)
    expect((error as Error).message).toMatch(/^Example sent more than/)
  })

  it('stops reading a body with no declared length as soon as it passes the limit', async () => {
    const response = streamed(10_000, 400)

    await expect(text(response.fetchImpl, 1000)).rejects.toThrow(/Example sent more than/)
    expect(response.pulled()).toBeLessThan(10)
  })

  it('refuses a declared length over the limit without reading any of the body', async () => {
    const response = streamed(10, 400, { headers: { 'content-length': '5000000' } })

    await expect(json(response.fetchImpl, 1000)).rejects.toThrow(/Example sent more than/)
    // A stream fills its queue with one chunk when it is made; nothing is read beyond that.
    expect(response.pulled()).toBeLessThanOrEqual(1)
  })

  it('applies a limit when the caller names none, and it is the one exported', async () => {
    const response = streamed(1, 10, { headers: { 'content-length': String(DEFAULT_MAX_BYTES + 1) } })

    await expect(text(response.fetchImpl)).rejects.toThrow(/Example sent more than 10 MB/)
    expect(DEFAULT_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('decodes text split across chunks the way `response.text()` does', async () => {
    const bytes = new TextEncoder().encode('café \u{1F600} and a very long tail'.repeat(5))
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // One byte at a time: every multi-byte character is split across chunks.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })

    expect(await text((async () => new Response(body)) as FetchLike, 100_000)).toBe(new TextDecoder().decode(bytes))
  })

  it('still says a body that is not JSON is not JSON, and still reads JSON', async () => {
    await expect(json(answer(200, {}, '<html>'))).rejects.toThrow('Example returned something that was not JSON.')
    expect(await json(answer(200, {}, '{"ok":true}'))).toEqual({ ok: true })
  })

  it('does not read an error body past a small limit either, and still reports the status', async () => {
    const response = streamed(100_000, 1024, { status: 500 })

    const error = await getJson('https://example.test/x', { source: 'Example', fetchImpl: response.fetchImpl }).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(UpstreamError)
    expect(error).toMatchObject({ status: 500 })
    expect(response.pulled()).toBeLessThan(200)
  })
})

/**
 * An upstream's error text may repeat the request, and the request holds the user's key (security review, Phase 19, SR-028). The
 * message is shown on screen, so a screenshot for a bug report or a log the user pastes would carry the key. Credentials are removed
 * from the text before it is cut to length and put in a message.
 */
describe('a credential the upstream echoes in an error is not shown', () => {
  const SECRET = 'SECRETKEY123456'

  /** An upstream that answers 400 with a JSON error whose message is `text(url, init)`. */
  const echoing = (text: (url: string, init: RequestInit) => string): FetchLike => async (url, init) =>
    new Response(JSON.stringify({ error: { message: text(url, init ?? {}) } }), { status: 400 })

  async function failureMessage(url: string, fetchImpl: FetchLike, options: { headers?: Record<string, string>; method?: 'GET' | 'POST'; body?: string } = {}): Promise<string> {
    const error = await getJson(url, { source: 'Example', fetchImpl, ...options }).then(() => undefined, (cause: unknown) => cause)

    expect(error).toBeInstanceOf(UpstreamError)

    return (error as Error).message
  }

  it.each([
    ['TMDB’s api_key', `https://api.example.test/3/search/person?query=Alien&api_key=${SECRET}`],
    ['YouTube’s key', `https://api.example.test/youtube/v3/search?part=snippet&key=${SECRET}&q=Alien`],
    ['Comic Vine’s api_key', `https://api.example.test/api/search/?api_key=${SECRET}&format=json&query=Alien`],
    ['a token', `https://api.example.test/x?access_token=${SECRET}`],
    ['a secret', `https://api.example.test/x?client_secret=${SECRET}&grant_type=client_credentials`],
  ])('removes %s from a message that repeats the address', async (_name, url) => {
    const message = await failureMessage(url, echoing((echoed) => `bad request ${echoed}`))

    expect(message).toMatch(/^Example returned 400: bad request https:\/\/api\.example\.test\//)
    expect(message).not.toContain(SECRET)
    expect(message).toContain('…')
  })

  it('keeps the rest of the address, so the message still says what was asked', async () => {
    const message = await failureMessage(`https://api.example.test/3/search/person?query=Alien&api_key=${SECRET}`, echoing((echoed) => `bad request ${echoed}`))

    expect(message).toContain('query=Alien')
    expect(message).toContain('/3/search/person')
  })

  it('removes a key the upstream repeats percent-encoded, or on its own, or with the quotes of JSON', async () => {
    const weird = 'a b&c/d+e=f'
    const url = `https://api.example.test/x?key=${encodeURIComponent(weird)}`
    const message = await failureMessage(url, echoing(() => `got ${encodeURIComponent(weird)} and ${weird} and "${weird}"`))

    expect(message).not.toContain(weird)
    expect(message).not.toContain(encodeURIComponent(weird))
  })

  it('removes a bearer token and a key header the upstream repeats', async () => {
    const message = await failureMessage(
      'https://api.example.test/x',
      echoing((_url, init) => `the token on its own: ${SECRET}; headers were ${JSON.stringify(init.headers)}`),
      { headers: { authorization: `Bearer ${SECRET}`, 'x-api-key': 'HEADERKEY654321', 'client-id': 'CLIENTID7777777', accept: 'application/json' } },
    )

    for (const secret of [SECRET, 'HEADERKEY654321', 'CLIENTID7777777']) expect(message).not.toContain(secret)
    expect(message).toContain('application/json')
  })

  it('removes the secret of a form body the upstream repeats (the Twitch token request)', async () => {
    const body = new URLSearchParams({ client_id: 'CLIENTID7777777', client_secret: SECRET, grant_type: 'client_credentials' }).toString()
    const message = await failureMessage('https://id.example.test/oauth2/token', echoing((_url, init) => `invalid request ${String(init.body)}`), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })

    expect(message).not.toContain(SECRET)
    expect(message).not.toContain('CLIENTID7777777')
    expect(message).toContain('grant_type=client_credentials')
  })

  it('removes a credential in a JSON body, whatever it is called here and however the upstream repeats it', async () => {
    const message = await failureMessage('https://id.example.test/x', echoing((_url, init) => `the value ${(JSON.parse(String(init.body)) as { client_id: string }).client_id} and ${(JSON.parse(String(init.body)) as { query: string }).query}`), {
      method: 'POST',
      body: JSON.stringify({ client_id: 'CLIENTID7777777', query: 'Alien' }),
    })

    expect(message).not.toContain('CLIENTID7777777')
    expect(message).toContain('Alien')
  })

  it('removes a credential-looking parameter even when the request did not carry it', async () => {
    const message = await failureMessage('https://api.example.test/x', echoing(() => 'try again with api_key=OTHERKEY9999999&key=ANOTHER88888888 or Bearer TOKENVALUE12345.abc-def'))

    for (const secret of ['OTHERKEY9999999', 'ANOTHER88888888', 'TOKENVALUE12345']) expect(message).not.toContain(secret)
  })

  it('removes it before cutting the message to length, so no half of a credential is left at the cut', async () => {
    // A value the generic `key=…` scrub does not know (a client id, a bare value), placed to straddle the 200th character.
    const id = 'CLIENTID7777777'
    const message = await failureMessage('https://api.example.test/x', echoing(() => `${'x'.repeat(188)} ${id}`), { headers: { 'client-id': id } })

    expect(message).not.toContain('CLIENTID')
    expect(message.length).toBeLessThan(260)
  })

  it('leaves a message with no credential in it as it was', async () => {
    expect((await failureMessage('https://api.example.test/x?query=Alien', echoing(() => 'down for maintenance, key points: none'))).endsWith('down for maintenance, key points: none')).toBe(true)
  })

  it('does not take the words out of a message because a short value matches them', async () => {
    const message = await failureMessage('https://api.example.test/x?key=abc', echoing(() => 'the abc of it, abc and abcdef'))

    expect(message).toContain('the abc of it, abc and abcdef')
  })

  it('also removes it from a plain-text error body', async () => {
    const message = await failureMessage(`https://api.example.test/x?api_key=${SECRET}`, async (url) => new Response(`Forbidden: ${url}`, { status: 400 }))

    expect(message).not.toContain(SECRET)
  })
})

/**
 * A request that carries a credential is made so that the webview keeps no copy (security review, Phase 19, SR-059). TMDB and YouTube
 * put the key in the address, and WebKit's network cache is keyed by the address: the owner's TMDB key was found in 198 of 346 cache
 * files under `~/Library/Caches`, where "remove my keys" and an uninstall do not reach it.
 */
describe('a request with a credential asks not to be cached', () => {
  const seen = (): { fetchImpl: FetchLike; inits: RequestInit[] } => {
    const inits: RequestInit[] = []

    return {
      inits,
      fetchImpl: async (_url, init) => {
        inits.push(init ?? {})

        return new Response('{}', { status: 200 })
      },
    }
  }

  it.each([
    ['a key in the address', 'https://api.example.test/x?api_key=SECRETKEY123456', {}],
    ['Google’s key in the address', 'https://api.example.test/x?part=snippet&key=SECRETKEY123456', {}],
    ['an Authorization header', 'https://api.example.test/x', { headers: { authorization: 'Bearer SECRETKEY123456' } }],
    ['a key header', 'https://api.example.test/x', { headers: { 'x-api-key': 'SECRETKEY123456' } }],
    ['a secret in a form body', 'https://id.example.test/token', { method: 'POST' as const, body: 'client_id=CLIENTID7777777&client_secret=SECRETKEY123456' }],
  ])('has `cache: "no-store"` for %s', async (_name, url, options) => {
    const { fetchImpl, inits } = seen()
    await getJson(url, { source: 'Example', fetchImpl, ...options })

    expect(inits[0]?.cache).toBe('no-store')
  })

  it.each([
    ['a plain address', 'https://api.example.test/x?query=Alien', {}],
    ['the library’s file', 'https://raw.example.test/lists/index.json', {}],
    ['a short value under a credential-like name', 'https://api.example.test/x?key=abc', {}],
  ])('leaves the cache alone for %s', async (_name, url, options) => {
    const { fetchImpl, inits } = seen()
    await getText(url, { source: 'Example', fetchImpl, ...options })

    expect(inits[0]).not.toHaveProperty('cache')
  })

  it('asks the same of the retry without a User-Agent', async () => {
    const inits: RequestInit[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      inits.push(init ?? {})
      if (inits.length === 1) throw new TypeError('the first attempt fails, as WebKit does with a User-Agent')

      return new Response('{}', { status: 200 })
    }
    await getJson('https://api.example.test/x?api_key=SECRETKEY123456', { source: 'Example', fetchImpl })

    expect(inits.map((init) => init.cache)).toEqual(['no-store', 'no-store'])
  })
})
