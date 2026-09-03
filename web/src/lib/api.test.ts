import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api.js'

function respondWith(body: unknown, status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('turning a failed response into something to show', () => {
  it('words a server error code from the locale', async () => {
    // The whole point of the code contract: the server names the situation,
    // the sentence is written once, here.
    respondWith({ code: 'search.unavailable', params: { category: 'Movies' } }, 409)

    await expect(api.lists()).rejects.toThrow('Search is not available for Movies. Add items by hand.')
  })

  it('falls back to a message for errors that carry one', async () => {
    // Fastify writes its own for schema violations and 404s, and upstream
    // failures report which service said what — neither is app copy.
    respondWith({ message: 'TMDB is rate-limiting us. Try again shortly.' }, 502)

    await expect(api.lists()).rejects.toThrow('TMDB is rate-limiting us. Try again shortly.')
  })

  it('falls back again for a code it does not recognise', async () => {
    // A newer server against an older web. Degrades to the status rather than
    // showing a raw code or throwing.
    respondWith({ code: 'invented.later' }, 418)

    await expect(api.lists()).rejects.toThrow('Request failed (418)')
  })

  it('prefers the code over a message when both are present', async () => {
    respondWith({ code: 'refresh.handMadeList', message: 'stale prose' }, 409)

    await expect(api.lists()).rejects.toThrow(
      'This list was made by hand, so there is nothing to check against.',
    )
  })

  it('says the server is unreachable rather than blaming the request', async () => {
    // During development this is by far the more common failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(api.lists()).rejects.toThrow('Cannot reach the server. Is it running?')
  })

  it('carries the status for callers that need it', async () => {
    respondWith({ code: 'search.queryRequired' }, 400)

    await expect(api.lists()).rejects.toMatchObject({ status: 400, name: 'ApiError' })
    expect(new ApiError('x', 400)).toBeInstanceOf(Error)
  })
})
