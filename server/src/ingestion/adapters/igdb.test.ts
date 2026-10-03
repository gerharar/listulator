import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { IGDB_PLATFORM_CODES } from '../../catalog/platforms.generated.js'
import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { createPacer, type RateLimiter } from '../rateLimiter.js'
import { createIgdbAdapter, igdbRequestLimiter } from './igdb.js'

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
      franchises: [{ id: 571, name: "Assassin's Creed", games: [1, 2, 3, 4, 5] }],
      collections: [{ id: 12998, name: "Assassin's Creed II", games: [1, 2] }],
    })

    expect(await createIgdbAdapter(credentials, fetchImpl).search('assassin')).toEqual([
      { externalRef: 'franchise:571', title: "Assassin's Creed — games", detail: 'Franchise' },
      { externalRef: 'collection:12998', title: "Assassin's Creed II", detail: 'Series' },
    ])
  })

  it('puts the one with the most entries first, franchises and series together (BL-055)', async () => {
    const entries = (n: number) => Array.from({ length: n }, (_, index) => index + 1)
    const { fetchImpl } = router({
      franchises: [{ id: 1, name: 'Small franchise', games: entries(3) }, { id: 2, name: 'Big franchise', games: entries(359) }],
      collections: [{ id: 3, name: 'Fan game', games: entries(1) }, { id: 4, name: 'Main series', games: entries(193) }, { id: 5, name: 'No list at all' }],
    })

    const found = await createIgdbAdapter(credentials, fetchImpl).search('x')

    expect(found.map((source) => source.title)).toEqual(['Big franchise — games', 'Main series', 'Small franchise — games', 'Fan game', 'No list at all'])
  })

  it('breaks a tie by name, so the order never changes between searches', async () => {
    const { fetchImpl } = router({
      franchises: [{ id: 1, name: 'Zeta', games: [1, 2] }, { id: 2, name: 'Alpha', games: [1, 2] }],
      collections: [],
    })

    expect((await createIgdbAdapter(credentials, fetchImpl).search('x')).map((source) => source.title)).toEqual(['Alpha — games', 'Zeta — games'])
  })

  it('shows at most ten, the ten with the most entries', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `Series ${String(index + 1).padStart(2, '0')}`, games: Array.from({ length: index + 1 }, (_, n) => n) }))
    const { fetchImpl } = router({ franchises: [], collections: many })

    const found = await createIgdbAdapter(credentials, fetchImpl).search('series')

    expect(found).toHaveLength(10)
    expect(found[0]!.title).toBe('Series 30')
    expect(found[9]!.title).toBe('Series 21')
  })

  it('strips quotes from the query, which would otherwise break the syntax', async () => {
    // IGDB queries are a string language, and the search box is user input.
    const { fetchImpl } = router({ franchises: [], collections: [] })
    await createIgdbAdapter(credentials, fetchImpl).search('say "what" \\ now')

    const call = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.includes('franchises'))!
    // Fifty candidates, not six: the right one must not be cut before the entries are counted (BL-055).
    expect(call[1]?.body).toBe('fields name,games; where name ~ *"say what  now"*; limit 50;')
  })
})

describe('IGDB platform tags', () => {
  // As IGDB answers `fields platforms`: ids only. Abbreviations in the tests are for the reader.
  const expand = async (platforms: { id: number; abbreviation?: string }[] | undefined) => {
    const { fetchImpl } = router({
      games: [
        {
          id: 1,
          name: 'Assassin’s Creed',
          first_release_date: 1194998400,
          game_type: 0,
          ...(platforms ? { platforms: platforms.map((platform) => platform.id) } : {}),
        },
      ],
      game_time_to_beats: [],
    })

    return (await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')).items[0]!
  }

  it('asks for each game’s platforms in the same request', async () => {
    const { fetchImpl } = router({ games: [], game_time_to_beats: [] })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const body = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.endsWith('/games'))![1]?.body
    expect(body).toContain('platforms;')
  })

  it('tags a game by IGDB platform id with the owner’s codes, in config/platforms.csv’s order (10.24c)', async () => {
    const game = await expand([
      { id: 12, abbreviation: 'X360' },
      { id: 6, abbreviation: 'PC' },
      { id: 9, abbreviation: 'PS3' },
    ])

    expect(game.tags).toEqual(['WIN', 'PS3', 'X360'])
  })

  it('goes by the id, not IGDB’s spelling: NGC, Series X|S, PS Vita all find their code', async () => {
    const game = await expand([
      { id: 21, abbreviation: 'NGC' },
      { id: 169, abbreviation: 'Series X|S' },
      { id: 41, abbreviation: 'WiiU' },
      { id: 46, abbreviation: 'PS Vita' },
      { id: 33, abbreviation: 'Game Boy' },
    ])

    expect(game.tags).toEqual(['XSX', 'VITA', 'WIIU', 'GB', 'GCN'])
  })

  it('tags a platform IGDB gives no abbreviation, since the id is enough', async () => {
    const game = await expand([{ id: 386 }, { id: 9 }])

    expect(game.tags).toEqual(['PS3', 'VR'])
  })

  it('tags several platforms that share a code once (Meta Quest 2 and 3 are both VR)', async () => {
    const game = await expand([{ id: 386 }, { id: 471 }])

    expect(game.tags).toEqual(['VR'])
  })

  it('leaves out a platform the table does not list (IGDB added it later): no guessed code; platforms:check flags it', async () => {
    const game = await expand([
      { id: 99_999, abbreviation: 'New Box' },
      { id: 99_998 },
      { id: 9, abbreviation: 'PS3' },
    ])

    expect(game.tags).toEqual(['PS3'])
    expect((await expand([{ id: 99_999, abbreviation: 'New Box' }])).tags).toBeUndefined()
  })

  it('never returns more tags than an item may carry', async () => {
    // 55 platforms with 55 different codes, all in the table.
    const ids = [...new Map(Object.entries(IGDB_PLATFORM_CODES).map(([id, code]) => [code, Number(id)])).values()].slice(0, 55)
    const game = await expand(ids.map((id) => ({ id })))

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

  it('expands a series by the game’s `collections` field: the old single `collection` returns nothing for any series now', async () => {
    // Live, 2026-10-04: `where collection = 39` found 0 games and `where collections = (39)` found 57 (Final Fantasy);
    // Assassin's Creed 0 and 28, Super Mario 0 and 60, Call of Duty 0 and 31. Every Series result built an empty list.
    const { fetchImpl, queries } = pagedIgdb(manyGames(3))
    const { items } = await createIgdbAdapter(credentials, fetchImpl).expand('collection:39')

    expect(items).toHaveLength(3)
    expect(queries('games')[0]!.body).toContain('where collections = (39)')
    expect(queries('games')[0]!.body).not.toMatch(/\bcollection = /)
  })

  it('asks for main games, remakes and remasters, leaving out DLC, ports, bundles and updates', async () => {
    const { fetchImpl } = router({ games: [], game_time_to_beats: [] })
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:571')

    const call = vi.mocked(fetchImpl).mock.calls.find(([url]) => url.endsWith('/games'))!
    // 0 Main Game, 8 Remake, 9 Remaster (owner, 2026-10-04: Final Fantasy VII Remake was missing, BL-056).
    expect(call[1]?.body).toContain('game_type = (0,8,9)')
    // Paged by id, which is unique, so a page never repeats or skips a game that shares a release date.
    expect(call[1]?.body).toContain('sort id asc')
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

/** A fake IGDB that honours `limit` and `offset`, and records every query it is asked. */
function pagedIgdb(allGames: { id: number; name: string; first_release_date?: number; game_type?: number }[], times: { game_id: number; normally: number }[] = []) {
  const asked: { endpoint: string; body: string }[] = []
  const fetchImpl: FetchLike = vi.fn(async (url: string, init) => {
    if (url.startsWith('https://id.twitch.tv')) return new Response(JSON.stringify({ access_token: 't', expires_in: 5000 }))

    const endpoint = new URL(url).pathname.split('/').pop()!
    const body = String(init?.body ?? '')
    asked.push({ endpoint, body })
    const limit = Number(/limit (\d+)/.exec(body)?.[1] ?? 10)
    const offset = Number(/offset (\d+)/.exec(body)?.[1] ?? 0)
    if (limit > 500) return new Response('{}', { status: 403 })

    if (endpoint === 'games') {
      // IGDB applies the `game_type` filter itself; the fake does too, so a type the query leaves out never arrives.
      const wanted = new Set((/game_type = \(?([\d,]+)\)?/.exec(body)?.[1] ?? '0').split(',').map(Number))
      const sorted = allGames.filter((game) => wanted.has(game.game_type ?? 0)).sort((a, b) => a.id - b.id)

      return new Response(JSON.stringify(sorted.slice(offset, offset + limit).map((game) => ({ game_type: 0, ...game }))))
    }
    if (endpoint === 'game_time_to_beats') {
      const wanted = new Set((/game_id = \(([\d,]+)\)/.exec(body)?.[1] ?? '').split(',').map(Number))

      return new Response(JSON.stringify(times.filter((entry) => wanted.has(entry.game_id)).slice(0, limit)))
    }

    return new Response('[]')
  })

  return { fetchImpl, asked, queries: (endpoint: string) => asked.filter((entry) => entry.endpoint === endpoint) }
}

const manyGames = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: index + 1, name: `Game ${index + 1}`, first_release_date: 946684800 + index * 86400 }))

describe('IGDB listing without a cap (audit 2, as BL-044 for TMDB)', () => {
  it('lists every game of a big franchise, not the first 300 (Disney has 400, Mario 319)', async () => {
    const { fetchImpl } = pagedIgdb(manyGames(1234))
    const { items } = await createIgdbAdapter(credentials, fetchImpl).expand('franchise:26')

    expect(items).toHaveLength(1234)
    expect(new Set(items.map((item) => item.externalRef)).size).toBe(1234)
  })

  it('asks in pages of at most 500, IGDB’s own ceiling (501 answers 403, which reads as bad credentials)', async () => {
    const { fetchImpl, queries } = pagedIgdb(manyGames(1234))
    await createIgdbAdapter(credentials, fetchImpl).expand('franchise:26')

    const pages = queries('games').map((entry) => [Number(/limit (\d+)/.exec(entry.body)![1]), Number(/offset (\d+)/.exec(entry.body)![1])])
    expect(pages).toEqual([[500, 0], [500, 500], [500, 1000]])
  })

  it('stops at a short page, and asks once for a list that fits in one', async () => {
    const small = pagedIgdb(manyGames(499))
    await createIgdbAdapter(credentials, small.fetchImpl).expand('franchise:1')
    expect(small.queries('games')).toHaveLength(1)

    // Exactly one full page: the next page is asked for, and is empty.
    const exact = pagedIgdb(manyGames(500))
    expect((await createIgdbAdapter(credentials, exact.fetchImpl).expand('franchise:1')).items).toHaveLength(500)
    expect(exact.queries('games')).toHaveLength(2)
  })

  it('pages by id and lists oldest first, ties in id order, so no game repeats or goes missing between pages', async () => {
    const games = [
      { id: 3, name: 'Third by id, oldest', first_release_date: 100 },
      { id: 1, name: 'First by id, same day as 2', first_release_date: 200 },
      { id: 2, name: 'Second by id, same day as 1', first_release_date: 200 },
      { id: 4, name: 'Newest', first_release_date: 300 },
    ]
    const { fetchImpl, queries } = pagedIgdb(games)
    const { items } = await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')

    expect(queries('games')[0]!.body).toContain('sort id asc')
    expect(items.map((item) => item.externalRef)).toEqual(['game:3', 'game:1', 'game:2', 'game:4'])
  })

  it('stops asking once the list is past the ceiling, and returns what it has for the shared check to refuse', async () => {
    const { fetchImpl, queries } = pagedIgdb(manyGames(MAX_LIST_ITEMS + 600))
    const { items } = await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')

    expect(items.length).toBeGreaterThan(MAX_LIST_ITEMS)
    // Twenty full pages hold the ceiling exactly; the twenty-first goes past it. No page after that.
    expect(queries('games')).toHaveLength(MAX_LIST_ITEMS / 500 + 1)
  })

  it('fetches the times in batches of at most 500 games, one request per batch, and applies every one', async () => {
    const games = manyGames(1234)
    const times = games.map((game) => ({ game_id: game.id, normally: 3600 }))
    const { fetchImpl, queries } = pagedIgdb(games, times)
    const { items } = await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')

    const batches = queries('game_time_to_beats').map((entry) => /game_id = \(([\d,]+)\)/.exec(entry.body)![1]!.split(',').length)
    expect(batches).toEqual([500, 500, 234])
    expect(items.every((item) => item.timeToConsumeMinutes === 60)).toBe(true)
  })

  it('keeps a game with no recorded time without one (the category default, estimated), never zero', async () => {
    const { fetchImpl } = pagedIgdb(manyGames(3), [{ game_id: 1, normally: 3600 }, { game_id: 2, normally: 10 }])
    const items = (await createIgdbAdapter(credentials, fetchImpl).expand('franchise:1')).items

    expect(items.map((item) => item.timeToConsumeMinutes)).toEqual([60, undefined, undefined])
  })
})

describe('IGDB retries and request budget (audit 2, as 15.1 for TMDB)', () => {
  const ok = () => new Response('[]', { status: 200 })
  const status = (code: number, headers: Record<string, string> = {}) => () => new Response('{}', { status: code, headers })

  function flaky(...responses: (() => Response)[]) {
    let call = 0
    const fetchImpl: FetchLike = vi.fn(async (url: string) =>
      url.startsWith('https://id.twitch.tv')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 5000 }))
        : responses[Math.min(call++, responses.length - 1)]!(),
    )
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const igdbCalls = () => vi.mocked(fetchImpl).mock.calls.filter(([url]) => url.includes('api.igdb.com')).length

    return { fetchImpl, sleep, igdbCalls }
  }

  it('waits the Retry-After a 429 asks for, then succeeds', async () => {
    const { fetchImpl, sleep, igdbCalls } = flaky(status(429, { 'retry-after': '2' }), ok)

    await createIgdbAdapter(credentials, fetchImpl, { sleep }).search('x')

    expect(sleep).toHaveBeenCalledWith(2000)
    // Two lookups run side by side in a search; each retried once at most.
    expect(igdbCalls()).toBeGreaterThanOrEqual(3)
  })

  it('backs off on a 5xx with no Retry-After, and gives up after three attempts naming the source', async () => {
    const { fetchImpl, sleep, igdbCalls } = flaky(status(503))

    const error = await createIgdbAdapter(credentials, fetchImpl, { sleep }).expand('franchise:1').catch((caught: unknown) => caught)

    expect((error as Error).message).toMatch(/^IGDB returned 503/)
    expect(igdbCalls()).toBe(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000])
  })

  it('does not wait out a Retry-After longer than a build should stall for', async () => {
    const { fetchImpl, sleep } = flaky(status(429, { 'retry-after': '120' }), ok)

    await expect(createIgdbAdapter(credentials, fetchImpl, { sleep }).expand('franchise:1')).rejects.toMatchObject({ status: 429 })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('does not retry an answer that will not change: a 400 from a bad query', async () => {
    const { fetchImpl, sleep, igdbCalls } = flaky(status(400))

    await expect(createIgdbAdapter(credentials, fetchImpl, { sleep }).expand('franchise:1')).rejects.toMatchObject({ status: 400 })
    expect(igdbCalls()).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('puts every request, a retry included, through one shared budget', async () => {
    const run = vi.fn((fn: () => Promise<unknown>) => fn())
    const { fetchImpl, sleep } = flaky(status(503), ok)

    await createIgdbAdapter(credentials, fetchImpl, { sleep, limiter: { run: run as RateLimiter['run'] } }).expand('franchise:1')

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('spaces the starts four a second, IGDB’s published limit, even for requests made side by side', async () => {
    let clock = 0
    const waits: number[] = []
    const sleep = (ms: number) => {
      const until = clock + ms
      waits.push(ms)

      return Promise.resolve().then(() => void (clock = Math.max(clock, until)))
    }
    const limiter = createPacer(250, { now: () => clock, sleep })
    const { fetchImpl } = flaky(ok)

    await createIgdbAdapter(credentials, fetchImpl, { limiter }).search('x')

    expect(waits).toEqual([250])
  })

  it('the shared limiter itself spaces starts 250 ms apart', async () => {
    vi.useFakeTimers()
    try {
      const starts: number[] = []
      const runs = [0, 1, 2].map(() => igdbRequestLimiter.run(async () => void starts.push(Date.now())))
      await vi.advanceTimersByTimeAsync(2000)
      await Promise.all(runs)

      expect(starts.slice(1).map((start, index) => start - starts[index]!)).toEqual([250, 250])
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the one shared limiter for the real IGDB and none for a fake fetch', async () => {
    const shared = vi.spyOn(igdbRequestLimiter, 'run')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.startsWith('https://id.twitch.tv') ? new Response(JSON.stringify({ access_token: 't', expires_in: 5000 })) : new Response('[]'))))

    try {
      await createIgdbAdapter(credentials, flaky(ok).fetchImpl).search('x')
      expect(shared).not.toHaveBeenCalled()

      await createIgdbAdapter(credentials).search('x')
      expect(shared).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      shared.mockRestore()
    }
  })
})

describe('IGDB token request', () => {
  it('keeps the client secret out of the URL, sending it in the request body as Twitch allows', async () => {
    const { fetchImpl } = router({ franchises: [], collections: [] })
    await createIgdbAdapter(credentials, fetchImpl).search('a')

    const [url, init] = vi.mocked(fetchImpl).mock.calls.find(([address]) => address.startsWith('https://id.twitch.tv'))!
    expect(url).not.toContain('secret')
    expect(url).not.toContain('client_id')
    expect(String(init?.body)).toContain('client_secret=secret')
    expect(String(init?.body)).toContain('grant_type=client_credentials')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
  })
})

describe('IGDB remakes and remasters (BL-056, owner 2026-10-04)', () => {
  const MAIN = 0
  const REMAKE = 8
  const REMASTER = 9
  const list = async (games: { id: number; name: string; first_release_date?: number; game_type?: number }[]) =>
    (await createIgdbAdapter(credentials, pagedIgdb(games).fetchImpl).expand('franchise:4')).items.map((item) => item.title)

  it('lists a remake and a remaster beside the main game', async () => {
    expect(
      await list([
        { id: 1, name: 'Final Fantasy VII', first_release_date: 100, game_type: MAIN },
        { id: 2, name: 'Final Fantasy VII Remake', first_release_date: 200, game_type: REMAKE },
        { id: 3, name: 'Final Fantasy X HD', first_release_date: 300, game_type: REMASTER },
      ]),
    ).toEqual(['Final Fantasy VII', 'Final Fantasy VII Remake', 'Final Fantasy X HD'])
  })

  it('does not drop a remake or remaster whose name ends in "Edition": that is its name, not a duplicate', async () => {
    expect(
      await list([
        { id: 1, name: 'Final Fantasy XV: Pocket Edition', first_release_date: 100, game_type: REMAKE },
        { id: 2, name: 'Final Fantasy: 20th Anniversary Edition', first_release_date: 200, game_type: REMASTER },
        // A main game filed as a Deluxe Edition is still the duplicate the filter exists for.
        { id: 3, name: 'Final Fantasy XVI: Deluxe Edition', first_release_date: 300, game_type: MAIN },
      ]),
    ).toEqual(['Final Fantasy XV: Pocket Edition', 'Final Fantasy: 20th Anniversary Edition'])
  })

  it('tells a remaster from the original when they share a name, by adding its type', async () => {
    expect(
      await list([
        { id: 1, name: 'Final Fantasy II', first_release_date: 100, game_type: MAIN },
        { id: 2, name: 'Final Fantasy II', first_release_date: 200, game_type: REMASTER },
        { id: 3, name: 'Final Fantasy III', first_release_date: 300, game_type: REMAKE },
      ]),
    ).toEqual(['Final Fantasy II', 'Final Fantasy II (Remaster)', 'Final Fantasy III'])
  })

  it('adds the year as well when two of the same type share a name (the Pixel Remasters)', async () => {
    const year = (y: number) => Date.UTC(y, 5, 1) / 1000
    expect(
      await list([
        { id: 1, name: 'Final Fantasy', first_release_date: year(1987), game_type: MAIN },
        { id: 2, name: 'Final Fantasy', first_release_date: year(2007), game_type: REMASTER },
        { id: 3, name: 'Final Fantasy', first_release_date: year(2021), game_type: REMASTER },
      ]),
    ).toEqual(['Final Fantasy', 'Final Fantasy (Remaster, 2007)', 'Final Fantasy (Remaster, 2021)'])
  })

  it('compares names without regard to case, and only among what is listed', async () => {
    expect(
      await list([
        { id: 1, name: 'Chrono Trigger', first_release_date: 100, game_type: MAIN },
        { id: 2, name: 'CHRONO TRIGGER', first_release_date: 200, game_type: REMAKE },
        // A DLC of the same name is not listed, so it makes nothing ambiguous.
        { id: 3, name: 'Secret of Mana', first_release_date: 300, game_type: MAIN },
        { id: 4, name: 'Secret of Mana', first_release_date: 400, game_type: 1 },
      ]),
    ).toEqual(['Chrono Trigger', 'CHRONO TRIGGER (Remake)', 'Secret of Mana'])
  })

  it('leaves two main games of one name as they are: only a remake or remaster gets a type', async () => {
    expect(
      await list([
        { id: 1, name: 'Sonic the Hedgehog', first_release_date: 100, game_type: MAIN },
        { id: 2, name: 'Sonic the Hedgehog', first_release_date: 200, game_type: MAIN },
      ]),
    ).toEqual(['Sonic the Hedgehog', 'Sonic the Hedgehog'])
  })
})
