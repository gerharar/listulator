import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { createIgdbAdapter } from './igdb.js'

/**
 * Fixtures are trimmed from real IGDB responses (verified live against
 * franchise 571, Assassin's Creed).
 */

const credentials = { clientId: 'client', clientSecret: 'secret' }

interface RouteOptions {
  /** Fails auth until a fresh token is fetched, mimicking an expired one. */
  rejectUntilRefreshed?: boolean
}

function router(routes: Record<string, unknown>, { rejectUntilRefreshed }: RouteOptions = {}) {
  let tokensIssued = 0

  const fetchImpl: FetchLike = vi.fn(async (url: string, init) => {
    if (url.startsWith('https://id.twitch.tv')) {
      tokensIssued += 1

      return new Response(JSON.stringify({ access_token: `token-${tokensIssued}`, expires_in: 5000 }))
    }

    const authorization = (init?.headers as Record<string, string>)?.['authorization']
    if (rejectUntilRefreshed && authorization === 'Bearer token-1') {
      return new Response('{}', { status: 401 })
    }

    const endpoint = new URL(url).pathname.split('/').pop()!

    return new Response(JSON.stringify(routes[endpoint] ?? []))
  })

  return { fetchImpl, tokensIssued: () => tokensIssued }
}

const GAMES = [
  { id: 1, name: "Assassin's Creed", first_release_date: 1194998400, game_type: 0 },
  // Editions are filed as separate main games upstream.
  { id: 2, name: "Assassin's Creed: Limited Edition", first_release_date: 1194998400, game_type: 0 },
  { id: 3, name: "Assassin's Creed II", first_release_date: 1258070400, game_type: 0 },
  { id: 4, name: "Assassin's Creed II: White Edition", first_release_date: 1258070400, game_type: 0 },
]

/** 40h and 25h in seconds; game 3 has no recorded time. */
const TIMES = [
  { game_id: 1, normally: 144000 },
  { game_id: 99, normally: 90000 },
]

describe('IGDB availability', () => {
  it('is unavailable without both halves of the credential', () => {
    expect(createIgdbAdapter({ clientId: undefined, clientSecret: undefined }).isAvailable()).toBe(
      false,
    )
    expect(createIgdbAdapter({ clientId: 'only-id', clientSecret: undefined }).isAvailable()).toBe(
      false,
    )
  })

  it('sees credentials that appear after construction', () => {
    // Same import-order trap that caught TMDB: the registry is built before
    // .env is read.
    delete process.env['LISTULATOR_IGDB_TEST']

    const adapter = createIgdbAdapter(() => ({
      clientId: process.env['LISTULATOR_IGDB_TEST'],
      clientSecret: 'secret',
    }))

    expect(adapter.isAvailable()).toBe(false)
    process.env['LISTULATOR_IGDB_TEST'] = 'appeared'
    expect(adapter.isAvailable()).toBe(true)

    delete process.env['LISTULATOR_IGDB_TEST']
  })
})

describe('IGDB token handling', () => {
  it('exchanges the client credentials for an app token, once', async () => {
    const { fetchImpl, tokensIssued } = router({ franchises: [], collections: [] })
    const adapter = createIgdbAdapter(credentials, fetchImpl)

    await adapter.search('a')
    await adapter.search('b')

    // Tokens last ~60 days; asking for a new one per request would be waste.
    expect(tokensIssued()).toBe(1)
  })

  it('sends both the client id and the bearer token, as IGDB requires', async () => {
    const { fetchImpl } = router({ franchises: [], collections: [] })
    await createIgdbAdapter(credentials, fetchImpl).search('a')

    const call = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.includes('api.igdb.com'))!
    const headers = call[1]?.headers as Record<string, string>

    expect(headers['client-id']).toBe('client')
    expect(headers['authorization']).toBe('Bearer token-1')
  })

  it('refreshes an expired token and retries, rather than failing', async () => {
    // A token outlives most processes, so expiry surfaces long after startup
    // and looks exactly like broken credentials.
    const { fetchImpl, tokensIssued } = router(
      { franchises: [{ id: 571, name: "Assassin's Creed" }], collections: [] },
      { rejectUntilRefreshed: true },
    )

    const sources = await createIgdbAdapter(credentials, fetchImpl).search('assassin')

    expect(tokensIssued()).toBe(2)
    expect(sources[0]).toMatchObject({ externalRef: 'franchise:571' })
  })

  it('gives up rather than looping when a refreshed token is also rejected', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) =>
      url.startsWith('https://id.twitch.tv')
        ? new Response(JSON.stringify({ access_token: 'token', expires_in: 5000 }))
        : new Response('{}', { status: 401 }),
    )

    await expect(createIgdbAdapter(credentials, fetchImpl).search('x')).rejects.toThrow(
      /rejected our credentials/,
    )
  })
})

describe('IGDB search', () => {
  it('offers franchises and series, labelled so they can be told apart', async () => {
    const { fetchImpl } = router({
      franchises: [{ id: 571, name: "Assassin's Creed" }],
      collections: [{ id: 12998, name: "Assassin's Creed II" }],
    })

    expect(await createIgdbAdapter(credentials, fetchImpl).search('assassin')).toEqual([
      { externalRef: 'franchise:571', title: "Assassin's Creed — games", detail: 'Franchise' },
      { externalRef: 'collection:12998', title: "Assassin's Creed II", detail: 'Series' },
    ])
  })

  it('strips quotes from the query, which would otherwise break the syntax', async () => {
    // IGDB queries are a string language, and the search box is user input.
    const { fetchImpl } = router({ franchises: [], collections: [] })
    await createIgdbAdapter(credentials, fetchImpl).search('say "what" \\ now')

    const call = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.includes('franchises'))!
    expect(call[1]?.body).toBe('fields name; where name ~ *"say what  now"*; limit 6;')
  })
})

describe('IGDB platform tags', () => {
  const expand = async (platforms: { id: number; abbreviation?: string; name?: string }[] | undefined) => {
    const { fetchImpl } = router({
      games: [{ id: 1, name: 'Assassin’s Creed', first_release_date: 1194998400, game_type: 0, platforms }],
      game_time_to_beats: [],
    })

    return (await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')).items[0]!
  }

  it('asks for each game’s platforms in the same request', async () => {
    const { fetchImpl } = router({ games: [], game_time_to_beats: [] })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const body = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.endsWith('/games'))![1]?.body
    expect(body).toContain('platforms.abbreviation')
  })

  it('tags a game with its platform codes, in the platform table’s order', async () => {
    const game = await expand([
      { id: 6, abbreviation: 'PC' },
      { id: 12, abbreviation: 'X360' },
      { id: 9, abbreviation: 'PS3' },
    ])

    expect(game.tags).toEqual(['PS3', 'X360', 'PC'])
  })

  it('maps IGDB’s spellings to the table’s codes', async () => {
    const game = await expand([
      { id: 1, abbreviation: 'NGC' },
      { id: 2, abbreviation: 'Series X|S' },
      { id: 3, abbreviation: 'WiiU' },
      { id: 4, abbreviation: 'PS Vita' },
      { id: 5, abbreviation: 'Game Boy' },
    ])

    expect(game.tags).toEqual(['VITA', 'XSX', 'GC', 'WIIU', 'GB'])
  })

  it('keeps a platform the table does not know as its own caps text, after the known ones', async () => {
    const game = await expand([
      { id: 80, abbreviation: 'Neo Geo' },
      { id: 23, abbreviation: 'DC' },
      { id: 9, abbreviation: 'PS3' },
    ])

    expect(game.tags).toEqual(['PS3', 'NEO GEO', 'DC'])
  })

  it('leaves out a platform with no abbreviation, and a repeated one', async () => {
    const game = await expand([{ id: 99 }, { id: 9, abbreviation: 'PS3' }, { id: 10, abbreviation: 'ps3' }])

    expect(game.tags).toEqual(['PS3'])
  })

  it('never returns more tags than an item may carry', async () => {
    const game = await expand(Array.from({ length: 55 }, (_, i) => ({ id: i, abbreviation: `X${i}` })))

    expect(game.tags).toHaveLength(40)
  })

  it('gives a game IGDB lists on no platform no tags at all', async () => {
    expect(await expand(undefined)).not.toHaveProperty('tags')
    expect(await expand([])).not.toHaveProperty('tags')
  })
})

describe('IGDB expansion', () => {
  it('expands a franchise to main games with times to beat', async () => {
    const { fetchImpl } = router({ games: GAMES, game_time_to_beats: TIMES })

    expect((await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')).items).toEqual([
      { title: "Assassin's Creed", externalRef: 'game:1', timeToConsumeMinutes: 2400, year: 2007 },
      { title: "Assassin's Creed II", externalRef: 'game:3', year: 2009 },
    ])
  })

  it('drops edition variants of a game it already has', async () => {
    // Upstream files "White Edition" as its own main game; importing five
    // copies of Assassin's Creed II is not a list anyone wants. The dash form
    // appears too — "Revelations - Signature Edition".
    const { fetchImpl } = router({
      games: [
        ...GAMES,
        { id: 5, name: "Assassin's Creed Revelations - Signature Edition", game_type: 0 },
      ],
      game_time_to_beats: [],
    })
    const titles = (await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')).items.map(
      (item) => item.title,
    )

    expect(titles).not.toContain("Assassin's Creed: Limited Edition")
    expect(titles).not.toContain("Assassin's Creed II: White Edition")
    expect(titles).not.toContain("Assassin's Creed Revelations - Signature Edition")
  })

  it('asks only for games that have actually come out', async () => {
    // IGDB carries announced and cancelled titles — Codename Hexe, Codename
    // Invictus — which cannot be played, let alone finished.
    const { fetchImpl } = router({ games: [], game_time_to_beats: [] })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const body = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.endsWith('/games'))![1]?.body
    expect(body).toContain('first_release_date != null')
    expect(body).toMatch(/first_release_date <= \d+/)
  })

  it('keeps a title that merely contains the word "edition"', async () => {
    // The filter is deliberately narrow: a wrongly dropped game has to be
    // noticed and typed back by hand, while an unwanted one is a click.
    const { fetchImpl } = router({
      games: [{ id: 9, name: 'Edition Wars', game_type: 0 }],
      game_time_to_beats: [],
    })

    expect((await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')).items).toHaveLength(1)
  })

  it('asks only for main games, leaving out DLC, ports and bundles', async () => {
    const { fetchImpl } = router({ games: [], game_time_to_beats: [] })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const call = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.endsWith('/games'))!
    expect(call[1]?.body).toContain('game_type = 0')
    expect(call[1]?.body).toContain('sort first_release_date asc')
  })

  it('fetches every time-to-beat in a single request', async () => {
    const { fetchImpl } = router({ games: GAMES, game_time_to_beats: TIMES })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const timeCalls = vi
      .mocked(fetchImpl)
      .mock.calls.filter(([url]) => url.endsWith('/game_time_to_beats'))

    expect(timeCalls).toHaveLength(1)
    expect(timeCalls[0]![1]?.body).toContain('where game_id = (1,3);')
  })

  it('skips the time lookup entirely when nothing survived filtering', async () => {
    const { fetchImpl } = router({ games: [], game_time_to_beats: TIMES })

    expect((await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')).items).toEqual([])
    expect(
      vi.mocked(fetchImpl).mock.calls.some(([url]) => url.endsWith('/game_time_to_beats')),
    ).toBe(false)
  })

  it('refuses refs that are not a numeric id', async () => {
    // These become part of an IGDB query string.
    const { fetchImpl } = router({ games: GAMES })
    const adapter = createIgdbAdapter(credentials, fetchImpl)

    expect((await adapter.expand('franchise:1); drop--')).items).toEqual([])
    expect((await adapter.expand('franchise:abc')).items).toEqual([])
    expect((await adapter.expand('nonsense')).items).toEqual([])
  })
})
