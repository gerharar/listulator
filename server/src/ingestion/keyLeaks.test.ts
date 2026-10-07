import { describe, expect, it } from 'vitest'
import { createComicVineAdapter } from './adapters/comicVine.js'
import { createIgdbAdapter } from './adapters/igdb.js'
import { createTmdbAdapter } from './adapters/tmdb.js'
import { createYouTubeAdapter } from './adapters/youtube.js'
import type { FetchLike } from './http.js'

/**
 * The same through the real adapters (security review, Phase 19, SR-028): TMDB, YouTube and Comic Vine each put the key in the
 * request address, and IGDB sends its Twitch secret in a form body and its token as a header. Each upstream here answers 400 with
 * an error that repeats the whole request, which none is known to do; what the adapter throws must not hold the key.
 */
const KEY = 'SECRETKEY123456'
const SECRET_PARTS = [KEY, 'TWITCHSECRET99887766', 'IGDBCLIENTID1122334', 'ACCESSTOKEN5566778899']

/** An upstream that answers 400 and says everything it was sent. */
const echoing: FetchLike = async (url, init) =>
  new Response(JSON.stringify({ error: { message: `bad request ${url} headers ${JSON.stringify(init?.headers ?? {})} body ${String(init?.body ?? '')}` } }), { status: 400 })

async function thrownBy(call: () => Promise<unknown>): Promise<string> {
  const error = await call().then(() => undefined, (cause: unknown) => cause)
  expect(error, 'the call should have failed').toBeInstanceOf(Error)

  return (error as Error).message
}

describe('what an adapter throws when its upstream echoes the request', () => {
  const cases: [string, () => Promise<unknown>][] = [
    ['TMDB with an api key', () => createTmdbAdapter({ apiKey: KEY, readAccessToken: undefined }, {}, echoing).search('Alien')],
    ['TMDB with a read access token', () => createTmdbAdapter({ apiKey: undefined, readAccessToken: KEY }, {}, echoing).search('Alien')],
    ['YouTube', () => createYouTubeAdapter({ apiKey: KEY }, echoing, { sleep: async () => undefined }).search('Alien')],
    ['Comic Vine', () => createComicVineAdapter({ apiKey: KEY }, echoing, { sleep: async () => undefined }).search('Alien')],
    [
      'IGDB (the Twitch token request)',
      () => createIgdbAdapter({ clientId: 'IGDBCLIENTID1122334', clientSecret: 'TWITCHSECRET99887766' }, echoing).search('Alien'),
    ],
  ]

  it.each(cases)('%s says what failed and not the key', async (_name, call) => {
    const message = await thrownBy(call)

    expect(message).toMatch(/returned 400/)
    for (const secret of SECRET_PARTS) expect(message).not.toContain(secret)
  })
})
