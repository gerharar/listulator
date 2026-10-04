import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { IngestionError, UnauthorizedError, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import { createComicVineAdapter } from './comicVine.js'

/**
 * Fixtures are trimmed from real Comic Vine responses (verified live against
 * volume 2045, Fantastic Four 1961).
 */

const credentials = { apiKey: 'test-key' }

function respondWith(body: unknown, status = 200): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

const VOLUMES = {
  status_code: 1,
  results: [
    {
      id: 2045,
      name: 'Fantastic Four',
      start_year: '1961',
      count_of_issues: 416,
      publisher: { name: 'Marvel' },
    },
    { id: 112685, name: 'Fantastic Four', start_year: '2018', count_of_issues: 48 },
  ],
}

/** Deliberately out of reading order, as their own sort returns them. */
const ISSUES = {
  status_code: 1,
  results: [
    { id: 3, issue_number: '10', name: 'The Return of Doctor Doom!', cover_date: '1963-01-01' },
    { id: 4, issue_number: '100', name: 'The Long Journey Home', cover_date: '1970-07-31' },
    { id: 1, issue_number: '1', name: 'The Fantastic Four!', cover_date: '1961-11-30' },
    { id: 2, issue_number: '2', cover_date: '1962-01-31' },
  ],
}

describe('Comic Vine adapter', () => {
  it('is unavailable without a key', () => {
    expect(createComicVineAdapter({ apiKey: undefined }).isAvailable()).toBe(false)
    expect(createComicVineAdapter({ apiKey: 'k' }).isAvailable()).toBe(true)
  })

  it('sees a key that appears after construction', () => {
    delete process.env['LISTULATOR_CV_TEST']
    const adapter = createComicVineAdapter(() => ({ apiKey: process.env['LISTULATOR_CV_TEST'] }))

    expect(adapter.isAvailable()).toBe(false)
    process.env['LISTULATOR_CV_TEST'] = 'later'
    expect(adapter.isAvailable()).toBe(true)

    delete process.env['LISTULATOR_CV_TEST']
  })

  it('finds volumes, told apart by year, length and publisher', async () => {
    // "Fantastic Four" alone matches five different runs.
    const adapter = createComicVineAdapter(credentials, respondWith(VOLUMES))

    expect(await adapter.search('fantastic four')).toEqual([
      {
        externalRef: 'volume:2045',
        title: 'Fantastic Four (1961)',
        detail: '1961 · 416 issues · Marvel',
        itemCount: 416,
      },
      { externalRef: 'volume:112685', title: 'Fantastic Four (2018)', detail: '2018 · 48 issues', itemCount: 48 },
    ])
  })

  it('puts issues in reading order, not lexical order', async () => {
    // Their sort=issue_number:asc returns #1, #10, #100 — the bug this fixes.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    expect((await adapter.expand('volume:2045')).items.map((item) => item.title)).toEqual([
      '#1 The Fantastic Four!',
      '#2',
      '#10 The Return of Doctor Doom!',
      '#100 The Long Journey Home',
    ])
  })

  it('sorts oddly-numbered issues last rather than dropping them', async () => {
    const adapter = createComicVineAdapter(
      credentials,
      respondWith({
        status_code: 1,
        results: [
          { id: 2, issue_number: 'Annual 1', name: 'Annual', cover_date: '1963-01-01' },
          { id: 1, issue_number: '1', name: 'First', cover_date: '1961-11-30' },
        ],
      }),
    )

    expect((await adapter.expand('volume:1')).items.map((item) => item.title)).toEqual([
      '#1 First',
      '#Annual 1 Annual',
    ])
  })

  it('leaves durations unset so the 15-minute category default applies', async () => {
    // A real page count would cost a request per issue, and their rate limit
    // is roughly 200 an hour.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    for (const item of (await adapter.expand('volume:2045')).items) {
      expect(item.timeToConsumeMinutes).toBeUndefined()
    }
  })

  it('leaves year unset — cover_date is not a reliable publication year', async () => {
    // A comic's cover_date is deliberately offset months ahead of when it
    // actually shipped and routinely crosses a year boundary, so deriving
    // year from it would be a confidently wrong value, not a missing one.
    // Revisit if Comic Vine ever exposes a real publication-date field.
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    for (const item of (await adapter.expand('volume:2045')).items) {
      expect(item.year).toBeUndefined()
    }
  })

  it('reads an error in the body of a 200 as an error, not as an empty list', async () => {
    // Their documented status_codes (100 to 105) come in the body; trusting the HTTP status alone would turn
    // a filter error into an empty list.
    const adapter = createComicVineAdapter(credentials, respondWith({ status_code: 104, error: 'Filter Error' }))

    const error = await adapter.search('x').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(IngestionError)
    expect(error).not.toBeInstanceOf(UnauthorizedError)
    expect((error as Error).message).toBe('Comic Vine: Filter Error')
  })

  it('reads a bad key as rejected credentials, as the real 401 and a 200 with code 100 both say', async () => {
    // Live (2026-10-04): a bad key is HTTP 401 with this body, not the 200 this adapter once assumed.
    const body = { status_code: 100, error: 'Invalid API Key' }

    for (const answer of [respondWith(body, 401), respondWith(body)]) {
      const error = await createComicVineAdapter(credentials, answer).search('x').catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(UnauthorizedError)
      expect((error as Error).message).toMatch(/Invalid API Key|rejected our credentials/)
    }
  })

  it('refuses refs that are not a numeric volume id', async () => {
    const adapter = createComicVineAdapter(credentials, respondWith(ISSUES))

    expect((await adapter.expand('volume:abc')).items).toEqual([])
    expect((await adapter.expand('issue:1')).items).toEqual([])
    expect((await adapter.expand('nonsense')).items).toEqual([])
  })

  it('stops paging once a run is exhausted', async () => {
    const fetchImpl = respondWith(ISSUES)
    await createComicVineAdapter(credentials, fetchImpl).expand('volume:2045')

    // A short page means the end; no reason to ask for more.
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(1)
  })
})

describe('Comic Vine rate limiting (task 10.12, Q11)', () => {
  it('does not fire concurrent requests at once: each waits its turn', async () => {
    const started: number[] = []
    let time = 0
    const limiter = createRateLimiter(1000, {
      now: () => time,
      sleep: async (ms) => {
        time += ms
      },
    })
    const fetchImpl: FetchLike = async () => {
      started.push(time)
      return new Response(JSON.stringify({ status_code: 1, results: [] }), { status: 200 })
    }
    const adapter = createComicVineAdapter(credentials, fetchImpl, { limiter })

    await Promise.all([adapter.search('a'), adapter.search('b'), adapter.expand('volume:1')])

    expect(started).toEqual([0, 1000, 2000])
  })
})

/** A volume of `total` issues as the API serves it: `limit` clamped to 100, `offset` honoured, the total in every answer. */
function volumeOf(total: number, { withTotal = true } = {}): FetchLike {
  return vi.fn(async (url: string) => {
    const params = new URL(url).searchParams
    const limit = Math.min(Number(params.get('limit') ?? 100), 100)
    const offset = Number(params.get('offset') ?? 0)
    const ids = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => offset + index + 1)

    return new Response(
      JSON.stringify({
        status_code: 1,
        ...(withTotal ? { number_of_total_results: total } : {}),
        results: ids.map((id) => ({ id, issue_number: String(id), cover_date: '1938-01-01' })),
      }),
    )
  })
}

const params = (fetchImpl: FetchLike) => vi.mocked(fetchImpl).mock.calls.map(([url]) => new URL(url).searchParams)

describe('a long volume', () => {
  it('lists every issue past five hundred, the newest included', async () => {
    // A cap of 500 on an oldest-first listing dropped the newest 364 of Action Comics' 864.
    const fetchImpl = volumeOf(864)
    const { items } = await createComicVineAdapter(credentials, fetchImpl).expand('volume:18005')

    expect(items).toHaveLength(864)
    expect(items[0]!.title).toBe('#1')
    expect(items[863]!.title).toBe('#864')
    expect(params(fetchImpl).map((page) => page.get('offset'))).toEqual(
      Array.from({ length: 9 }, (_, index) => String(index * 100)),
    )
  })

  it('pages by issue id, which is unique, so a page can neither repeat nor skip an issue', async () => {
    // Reading order is made here after the fact, so the order upstream only has to be stable.
    const fetchImpl = volumeOf(250)
    await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')

    expect(params(fetchImpl).every((page) => page.get('sort') === 'id:asc')).toBe(true)
    expect(params(fetchImpl).every((page) => page.get('limit') === '100')).toBe(true)
  })

  it('stops at the total when the last page is exactly full, without asking for an empty one', async () => {
    const fetchImpl = volumeOf(200)

    expect((await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')).items).toHaveLength(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('still stops on a short page when the answer carries no total', async () => {
    const fetchImpl = volumeOf(150, { withTotal: false })

    expect((await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')).items).toHaveLength(150)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stops paging once past what a list can hold, handing back what it has for the size check to refuse', async () => {
    const fetchImpl = volumeOf(MAX_LIST_ITEMS + 1000)
    const { items } = await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')

    expect(items.length).toBeGreaterThan(MAX_LIST_ITEMS)
    expect(items.length).toBeLessThanOrEqual(MAX_LIST_ITEMS + 100)
    expect(fetchImpl).toHaveBeenCalledTimes(Math.floor(MAX_LIST_ITEMS / 100) + 1)
  })

  it('keeps a volume of exactly the most a list can hold', async () => {
    const fetchImpl = volumeOf(MAX_LIST_ITEMS)

    expect((await createComicVineAdapter(credentials, fetchImpl).expand('volume:1')).items).toHaveLength(MAX_LIST_ITEMS)
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_LIST_ITEMS / 100)
  })
})

describe('a count', () => {
  it('is one request for the whole total, not a listing', async () => {
    // The Search tab counts every result it shows, and every request draws on the same hourly budget.
    const fetchImpl = volumeOf(864)

    expect(await createComicVineAdapter(credentials, fetchImpl).count!('volume:18005')).toBe(864)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(params(fetchImpl)[0]!.get('limit')).toBe('1')
    expect(params(fetchImpl)[0]!.get('filter')).toBe('volume:18005')
  })

  it('has no answer for a ref it does not understand, or when the answer carries no total', async () => {
    const fetchImpl = volumeOf(5, { withTotal: false })
    const adapter = createComicVineAdapter(credentials, fetchImpl)

    expect(await adapter.count!('volume:abc')).toBeUndefined()
    expect(await adapter.count!('issue:1')).toBeUndefined()
    expect(await adapter.count!('nonsense')).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await adapter.count!('volume:1')).toBeUndefined()
  })

  it('counts zero for a volume with no issues, which is an answer', async () => {
    expect(await createComicVineAdapter(credentials, volumeOf(0)).count!('volume:1')).toBe(0)
  })

  it('fails when the request fails, rather than answering zero', async () => {
    const adapter = createComicVineAdapter(credentials, respondWith({}, 400))

    await expect(adapter.count!('volume:1')).rejects.toBeInstanceOf(IngestionError)
  })
})

describe('Comic Vine retries', () => {
  const noWait = vi.fn<(ms: number) => Promise<void>>(async () => {})
  const flaky = (...statuses: number[]): FetchLike => {
    const pending = [...statuses]

    return vi.fn(async () => {
      const status = pending.shift()

      return status
        ? new Response('{}', { status })
        : new Response(JSON.stringify({ status_code: 1, results: [{ id: 1, issue_number: '1' }] }))
    })
  }

  it('tries a 503 again and lists what the second answer holds', async () => {
    noWait.mockClear()
    const { items } = await createComicVineAdapter(credentials, flaky(503), { sleep: noWait }).expand('volume:1')

    expect(items).toHaveLength(1)
    expect(noWait).toHaveBeenCalledWith(500)
  })

  it('does not try a 400 or rejected credentials again', async () => {
    for (const status of [400, 401]) {
      const fetchImpl = flaky(status, status)

      await expect(createComicVineAdapter(credentials, fetchImpl, { sleep: noWait }).search('x')).rejects.toBeInstanceOf(IngestionError)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('sends every retry through the limiter as well, so a retry takes its turn in the one line', async () => {
    let turns = 0
    const limiter: RateLimiter = {
      run: (work) => {
        turns += 1

        return work()
      },
    }

    await createComicVineAdapter(credentials, flaky(503, 503), { sleep: noWait, limiter }).search('x')

    expect(turns).toBe(3)
  })
})

describe('one line for the whole process', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('spaces the requests of two adapters, as a settings change builds a new one beside the old', async () => {
    // Comic Vine throttles by velocity; a second adapter with a queue of its own would double the pace.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const started: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        started.push(Date.now())

        return new Response(JSON.stringify({ status_code: 1, results: [] }))
      }),
    )

    const first = createComicVineAdapter(credentials)
    const second = createComicVineAdapter(credentials)
    const work = Promise.all([first.search('a'), second.search('b'), first.search('c')])
    await vi.advanceTimersByTimeAsync(3000)
    await work

    expect(started.map((time) => time - started[0]!)).toEqual([0, 1100, 2200])
  })
})

interface RawVolume {
  id: number
  name: string
  start_year?: string | null
  count_of_issues?: number | null
}

/** Comic Vine's search over `volumes` in relevance order: `page` and `limit` (100 at most) honoured, the total in every answer. */
function searchOf(volumes: RawVolume[]): FetchLike {
  return vi.fn(async (url: string) => {
    const query = new URL(url).searchParams
    const limit = Math.min(Number(query.get('limit') ?? 10), 100)
    const page = Number(query.get('page') ?? 1)

    return new Response(
      JSON.stringify({
        status_code: 1,
        number_of_total_results: volumes.length,
        results: volumes.slice((page - 1) * limit, page * limit),
      }),
    )
  })
}

/** `count` volumes all called "Batman", the nth with n issues, in an order that is not the order of their size. */
const batmen = (count: number, first = 1): RawVolume[] =>
  Array.from({ length: count }, (_, index) => ({
    id: first + index,
    name: 'Batman',
    start_year: String(1940 + ((first + index) % 80)),
    count_of_issues: first + index,
  }))

const rows = (page: { sources: { externalRef: string }[] }) => page.sources.map((source) => source.externalRef)

describe('a page of search results', () => {
  it('ranks by issue count and keeps only volumes whose title contains the query', async () => {
    // Comic Vine's own order puts the fuzzy matches (Manga Action, 426) among, and above, the real runs.
    const adapter = createComicVineAdapter(
      credentials,
      searchOf([
        { id: 1, name: 'Manga Action', start_year: '2004', count_of_issues: 426 },
        { id: 2, name: 'Action Comics', start_year: '2011', count_of_issues: 57 },
        { id: 3, name: 'Action Comics', start_year: '1938', count_of_issues: 864 },
        { id: 4, name: 'Action (1993)', start_year: '1993', count_of_issues: 385 },
        { id: 5, name: 'Action Comics Weekly', start_year: '1988', count_of_issues: 42 },
      ]),
    )

    expect(rows(await adapter.searchPage!('action comics'))).toEqual(['volume:3', 'volume:2', 'volume:5'])
  })

  it('matches the title as the row shows it, year included, with accents, punctuation and case folded', async () => {
    const volumes: RawVolume[] = [
      { id: 1, name: 'Batman', start_year: '2016', count_of_issues: 163 },
      { id: 2, name: 'Batman', start_year: '1940', count_of_issues: 716 },
      { id: 3, name: 'X-Men', start_year: '1991', count_of_issues: 275 },
      { id: 4, name: 'Pokémon Adventures', start_year: '1997', count_of_issues: 90 },
    ]
    const adapter = createComicVineAdapter(credentials, searchOf(volumes))

    expect(rows(await adapter.searchPage!('Batman 2016'))).toEqual(['volume:1'])
    expect(rows(await adapter.searchPage!('batman (1940)'))).toEqual(['volume:2'])
    expect(rows(await adapter.searchPage!('x men'))).toEqual(['volume:3'])
    expect(rows(await adapter.searchPage!('POKEMON'))).toEqual(['volume:4'])
  })

  it('breaks a tie in issue count by name, then year (none last), then id, so a later page cannot reorder an earlier one', async () => {
    const tied: RawVolume[] = [
      { id: 9, name: 'Abe', start_year: '1990', count_of_issues: 10 },
      { id: 8, name: 'Abe', start_year: '2000', count_of_issues: 10 },
      { id: 7, name: 'Abe', start_year: '1990', count_of_issues: 10 },
      { id: 6, name: 'Abe', start_year: '1990', count_of_issues: 10 },
      { id: 5, name: 'Abe', start_year: null, count_of_issues: 10 },
      { id: 4, name: 'Abe B', start_year: '1990', count_of_issues: 10 },
    ]
    const wanted = ['volume:6', 'volume:7', 'volume:9', 'volume:8', 'volume:5', 'volume:4']

    // The same answer in any order of arrival ranks the same way.
    for (const order of [tied, [...tied].reverse(), [tied[2]!, tied[4]!, tied[0]!, tied[5]!, tied[3]!, tied[1]!]]) {
      expect(rows(await createComicVineAdapter(credentials, searchOf(order)).searchPage!('abe'))).toEqual(wanted)
    }
  })

  it('seeds each row’s count from the search answer, and leaves it out when the answer has none', async () => {
    const adapter = createComicVineAdapter(
      credentials,
      searchOf([
        { id: 1, name: 'Batman', start_year: '1940', count_of_issues: 716 },
        { id: 2, name: 'Batman', start_year: '1941', count_of_issues: 0 },
        { id: 3, name: 'Batman', start_year: '1942', count_of_issues: null },
        { id: 4, name: 'Batman', start_year: '1943' },
      ]),
    )

    const { sources } = await adapter.searchPage!('batman')

    expect(sources.map((source) => [source.externalRef, source.itemCount])).toEqual([
      ['volume:1', 716],
      ['volume:2', 0],
      ['volume:3', undefined],
      ['volume:4', undefined],
    ])
  })

  it('shows twenty rows, and says there is more only when there is a twenty-first', async () => {
    const twenty = await createComicVineAdapter(credentials, searchOf(batmen(20))).searchPage!('batman')
    const twentyOne = await createComicVineAdapter(credentials, searchOf(batmen(21))).searchPage!('batman')

    expect(twenty.sources).toHaveLength(20)
    expect(twenty.hasMore).toBeUndefined()
    expect(twentyOne.sources).toHaveLength(20)
    expect(twentyOne.hasMore).toBe(true)
  })

  it('counts what it found, exactly when it has looked at every match', async () => {
    const all = await createComicVineAdapter(credentials, searchOf(batmen(35))).searchPage!('batman')

    expect(all).toMatchObject({ total: 35, hasMore: true })
    expect(all.totalIsLowerBound).toBeUndefined()
  })

  it('counts a lower bound when it has not looked at every match: 20 of 52+', async () => {
    // 250 matches in all; the first hundred hold 52 that qualify, which is enough for the first pages.
    const volumes = [...batmen(52), ...Array.from({ length: 198 }, (_, index) => ({ id: 1000 + index, name: 'Other', start_year: '2000', count_of_issues: 5 }))]
    const fetchImpl = searchOf([...volumes.slice(0, 52), ...volumes.slice(52, 100), ...volumes.slice(100)])
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman')

    expect(page).toMatchObject({ total: 52, hasMore: true, totalIsLowerBound: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('asks for a hundred matches at a time, by Comic Vine’s own page number, with the query as typed', async () => {
    const fetchImpl = searchOf(batmen(3))
    await createComicVineAdapter(credentials, fetchImpl).searchPage!('Batman  Dark')

    const sent = new URL(vi.mocked(fetchImpl).mock.calls[0]![0]).searchParams
    expect([sent.get('limit'), sent.get('page'), sent.get('resources'), sent.get('query')]).toEqual(['100', '1', 'volume', 'Batman  Dark'])
  })

  it('a later page continues the same ranking: rows 21 to 40, no repeat of the first twenty', async () => {
    const adapter = createComicVineAdapter(credentials, searchOf(batmen(52)))
    const first = rows(await adapter.searchPage!('batman'))
    const second = await adapter.searchPage!('batman', { page: 2 })
    const third = await adapter.searchPage!('batman', { page: 3 })

    expect(first).toHaveLength(20)
    expect(rows(second)).toHaveLength(20)
    expect(rows(third)).toHaveLength(12)
    expect(new Set([...first, ...rows(second), ...rows(third)]).size).toBe(52)
    expect(second.hasMore).toBe(true)
    expect(third.hasMore).toBeUndefined()
    expect(third.totalIsLowerBound).toBeUndefined()
  })

  it('reads the next hundred only when the first has too few that qualify, ranking each hundred by itself', async () => {
    // The first hundred holds 10 qualifying volumes (small), the second 15 (larger): the rows of the second come after
    // those of the first, however big, so a row already on screen never moves.
    const noise = (from: number, count: number): RawVolume[] => Array.from({ length: count }, (_, index) => ({ id: from + index, name: 'Noise', start_year: '2000', count_of_issues: 1 }))
    const small = batmen(10, 1)
    const large = batmen(15, 500)
    const fetchImpl = searchOf([...small, ...noise(100, 90), ...large, ...noise(200, 85)])
    const adapter = createComicVineAdapter(credentials, fetchImpl)

    const page = await adapter.searchPage!('batman')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(rows(page).slice(0, 10).sort()).toEqual(small.map((volume) => `volume:${volume.id}`).sort())
    expect(rows(page).slice(10)).toEqual(large.map((volume) => `volume:${volume.id}`).reverse().slice(0, 10))
  })

  it('stops after five hundreds, and says there is no more rather than chain requests through a query with few matches', async () => {
    const noise: RawVolume[] = Array.from({ length: 2000 }, (_, index) => ({ id: 10_000 + index, name: 'Noise', start_year: '2000', count_of_issues: 1 }))
    const fetchImpl = searchOf([...batmen(3), ...noise])
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman')

    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(rows(page)).toHaveLength(3)
    expect(page.hasMore).toBeUndefined()
    expect(page.totalIsLowerBound).toBe(true)
  })

  it('has no rows past the end, and asks for no hundred beyond the last', async () => {
    const fetchImpl = searchOf(batmen(5))
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman', { page: 4 })

    expect(page.sources).toEqual([])
    expect(page.hasMore).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats a page below the first as the first', async () => {
    const adapter = createComicVineAdapter(credentials, searchOf(batmen(30)))

    expect(await adapter.searchPage!('batman', { page: 0 })).toEqual(await adapter.searchPage!('batman'))
    expect(await adapter.searchPage!('batman', { page: -3 })).toEqual(await adapter.searchPage!('batman'))
  })

  it('stops on a short page even when the total claims more, rather than ask for pages that are not there', async () => {
    const fetchImpl: FetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ status_code: 1, number_of_total_results: 900, results: batmen(5) })),
    )
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(rows(page)).toHaveLength(5)
  })

  it('asks for no second hundred when the first holds every match, exactly a hundred', async () => {
    // Five qualify among exactly a hundred matches: nothing in the first twenty-one rows ends the reading early,
    // only knowing that a hundred is all there is.
    const noise: RawVolume[] = Array.from({ length: 95 }, (_, index) => ({ id: 500 + index, name: 'Noise', start_year: '2000', count_of_issues: 1 }))
    const fetchImpl = searchOf([...batmen(5), ...noise])
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(page).toMatchObject({ total: 5 })
    expect(page.hasMore).toBeUndefined()
    expect(page.totalIsLowerBound).toBeUndefined()
  })

  it('reads on to the next hundred to learn whether a twenty-first row exists', async () => {
    // Exactly twenty qualify in the first hundred; the twenty-first is in the second. Stopping at twenty would
    // say there is no more.
    const noise: RawVolume[] = Array.from({ length: 80 }, (_, index) => ({ id: 500 + index, name: 'Noise', start_year: '2000', count_of_issues: 1 }))
    const fetchImpl = searchOf([...batmen(20), ...noise, ...batmen(1, 900), ...noise.map((volume) => ({ ...volume, id: volume.id + 1000 }))])
    const page = await createComicVineAdapter(credentials, fetchImpl).searchPage!('batman')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(page.sources).toHaveLength(20)
    expect(page.hasMore).toBe(true)
  })

  it('asks nothing for a query with no letters or digits in it', async () => {
    const fetchImpl = searchOf(batmen(5))

    expect(await createComicVineAdapter(credentials, fetchImpl).searchPage!('?!')).toEqual({ sources: [] })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails when a request fails, rather than showing the rows found so far as all there is', async () => {
    const adapter = createComicVineAdapter(credentials, respondWith({}, 400))

    await expect(adapter.searchPage!('batman')).rejects.toBeInstanceOf(IngestionError)
  })

  it('is what `search` shows: the first page of twenty', async () => {
    const adapter = createComicVineAdapter(credentials, searchOf(batmen(30)))

    expect(await adapter.search('batman')).toEqual((await adapter.searchPage!('batman')).sources)
    expect(await adapter.search('batman')).toHaveLength(20)
  })
})
