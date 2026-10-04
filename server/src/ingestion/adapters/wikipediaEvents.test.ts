import { describe, expect, it, vi } from 'vitest'
import { IngestionError, type FetchLike } from '../http.js'
import {
  createPageCache,
  createWikipediaEventsAdapter,
  UFC_SUB_SERIES,
  WWE_SUB_SERIES,
  type Promotion,
} from './wikipediaEvents.js'

/** Fixtures are shaped after the real UFC and WWE "List of … events" pages. */

function respondWith(wikitext: string): FetchLike {
  return vi.fn(async () =>
    new Response(JSON.stringify({ parse: { wikitext: { '*': wikitext } } }), { status: 200 }),
  )
}

const noWait = vi.fn<(ms: number) => Promise<void>>(async () => {})

const UFC: Promotion = {
  key: 'ufc',
  name: 'UFC events',
  page: 'List of UFC events',
  detail: 'Every UFC event',
}

const WWE: Promotion = {
  key: 'wwe',
  name: 'WWE pay-per-views',
  page: 'List of WWE pay-per-view and livestreaming supercards',
  detail: 'WWF/WWE',
}

describe('Wikipedia events expansion', () => {
  it('reads a per-row year from a templated date, UFC-style', async () => {
    // No year sections here — every row carries its own date.
    const wikitext = [
      '==Past events==',
      '{| class="wikitable"',
      '! Event !! Date',
      '|-',
      '|[[UFC 1]]',
      '|{{dts|1993|Nov|12}}',
      '|-',
      '|[[UFC 2]]',
      '|{{dts|1994|Mar|11}}',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([UFC], respondWith(wikitext))

    expect((await adapter.expand('promotion:ufc')).items).toEqual([
      { title: 'UFC 1', year: 1993 },
      { title: 'UFC 2', year: 1994 },
    ])
  })

  it('takes the year from the section heading, WWE-style, where the row has none', async () => {
    // The WWE page writes "March 31" with the year only in the heading —
    // a row-only lookup would find nothing.
    const wikitext = [
      '==1985==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|March 31',
      '|[[WrestleMania I|WrestleMania]]',
      '|}',
      '==1986==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|April 7',
      '|WrestleMania 2',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext))

    expect((await adapter.expand('promotion:wwe')).items).toEqual([
      { title: 'WrestleMania (1985)', year: 1985 },
      { title: 'WrestleMania 2 (1986)', year: 1986 },
    ])
  })

  it('leaves year unset when neither the section nor the row names one', async () => {
    const wikitext = [
      '==Events==',
      '{| class="wikitable"',
      '! Event !! Venue',
      '|-',
      '|Some Card',
      '|Some Arena',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([UFC], respondWith(wikitext))

    expect((await adapter.expand('promotion:ufc')).items).toEqual([{ title: 'Some Card' }])
  })

  it('sorts chronologically even when the page lists its year sections out of order', async () => {
    // Nothing about the parser trusts section order — this reverses WWE's
    // real 1985/1986 layout to prove the output is sorted, not just replayed.
    const wikitext = [
      '==1986==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|April 7',
      '|WrestleMania 2',
      '|}',
      '==1985==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|March 31',
      '|[[WrestleMania I|WrestleMania]]',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext))

    expect((await adapter.expand('promotion:wwe')).items).toEqual([
      { title: 'WrestleMania (1985)', year: 1985 },
      { title: 'WrestleMania 2 (1986)', year: 1986 },
    ])
  })

  it('keeps a dateless event in place rather than letting the sort move it', async () => {
    // A year alone cannot tell "Some Card" apart from either UFC 1 or UFC 2,
    // so it must stay exactly where document order put it: after UFC 1,
    // before UFC 2.
    const wikitext = [
      '==Past events==',
      '{| class="wikitable"',
      '! Event !! Date',
      '|-',
      '|[[UFC 1]]',
      '|{{dts|1993|Nov|12}}',
      '|-',
      '|Some Card',
      '|',
      '|-',
      '|[[UFC 2]]',
      '|{{dts|1994|Mar|11}}',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([UFC], respondWith(wikitext))

    expect((await adapter.expand('promotion:ufc')).items).toEqual([
      { title: 'UFC 1', year: 1993 },
      { title: 'Some Card' },
      { title: 'UFC 2', year: 1994 },
    ])
  })
})

describe('sub-series search (task 6.8)', () => {
  it('surfaces a sub-series as its own search result, alongside the full promotion', async () => {
    const adapter = createWikipediaEventsAdapter([WWE], respondWith(''), WWE_SUB_SERIES)

    expect(await adapter.search('wrestlemania')).toEqual([
      { externalRef: 'subseries:wrestlemania', title: 'All WrestleMania PPVs (WWF/WWE)' },
    ])

    const both = await adapter.search('w')
    expect(both.map((result) => result.externalRef)).toEqual(
      expect.arrayContaining(['promotion:wwe', 'subseries:wrestlemania']),
    )
  })

  it('filters a WWE promotion down to just its WrestleMania events', async () => {
    const wikitext = [
      '==1985==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|March 31',
      '|[[WrestleMania I|WrestleMania]]',
      '|}',
      '==1988==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|January 24',
      '|Royal Rumble',
      '|}',
      '==1989==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|April 2',
      '|WrestleMania V',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext), WWE_SUB_SERIES)

    expect((await adapter.expand('subseries:wrestlemania')).items).toEqual([
      { title: 'WrestleMania (1985)', year: 1985 },
      { title: 'WrestleMania V (1989)', year: 1989 },
    ])
  })

  it('filters a WWE promotion down to just its Royal Rumble events', async () => {
    const wikitext = [
      '==1988==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|January 24',
      '|Royal Rumble',
      '|}',
      '==1989==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|April 2',
      '|WrestleMania V',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext), WWE_SUB_SERIES)

    expect((await adapter.expand('subseries:royal-rumble')).items).toEqual([
      { title: 'Royal Rumble (1988)', year: 1988 },
    ])
  })

  it('splits UFC into numbered vs. Fight Night, excluding named specials from both', async () => {
    // Real title shapes, verified against the live page: numbered, Fight
    // Night, and outliers that are neither.
    const wikitext = [
      '==Past events==',
      '{| class="wikitable"',
      '! Event !! Date',
      '|-',
      '|[[UFC 1|UFC 1: The Beginning]]',
      '|{{dts|1993|Nov|12}}',
      '|-',
      '|UFC Fight Night: Hooker vs. Parnasse',
      '|{{dts|2026|Sep|5}}',
      '|-',
      '|UFC: The Ultimate Ultimate',
      '|{{dts|1995|Dec|16}}',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([UFC], respondWith(wikitext), UFC_SUB_SERIES)

    expect((await adapter.expand('subseries:ufc-numbered')).items).toEqual([
      { title: 'UFC 1: The Beginning', year: 1993 },
    ])
    expect((await adapter.expand('subseries:ufc-fight-night')).items).toEqual([
      { title: 'UFC Fight Night: Hooker vs. Parnasse', year: 2026 },
    ])
  })

  it('Fight Night also catches the early "Ultimate Fight Night" branding, unnumbered included', async () => {
    // Real title shapes, verified against the live page: the series was
    // "UFC Ultimate Fight Night" (no number) for its first event, "UFC
    // Ultimate Fight Night N" for events 2–5, and only "UFC Fight Night N"
    // from event 6 (Oct 2006) onward. A plain `startsWith('ufc fight
    // night')` silently missed the first five entirely.
    const wikitext = [
      '==Past events==',
      '{| class="wikitable"',
      '! Event !! Date',
      '|-',
      '|[[2005 in UFC#UFC Ultimate Fight Night|UFC Ultimate Fight Night]]',
      '|{{dts|2005|Aug|6}}',
      '|-',
      '|[[UFC Ultimate Fight Night 2]]',
      '|{{dts|2005|Oct|3}}',
      '|-',
      '|UFC Fight Night 6',
      '|{{dts|2006|Oct|10}}',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([UFC], respondWith(wikitext), UFC_SUB_SERIES)

    expect((await adapter.expand('subseries:ufc-fight-night')).items).toEqual([
      { title: 'UFC Ultimate Fight Night', year: 2005 },
      { title: 'UFC Ultimate Fight Night 2', year: 2005 },
      { title: 'UFC Fight Night 6', year: 2006 },
    ])
  })

  it('returns nothing for an unknown sub-series key', async () => {
    const adapter = createWikipediaEventsAdapter([WWE], respondWith(''), WWE_SUB_SERIES)

    expect((await adapter.expand('subseries:no-such-series')).items).toEqual([])
  })

  it('exact-match sub-series do not bleed into a same-prefix sibling show', async () => {
    // "Vengeance" and "Vengeance Day" are two different real WWE shows
    // sharing a common prefix — exact-match must tell them apart.
    const wikitext = [
      '==2001==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|December 9',
      '|Vengeance',
      '|}',
      '==2023==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|February 4',
      '|Vengeance Day',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext), WWE_SUB_SERIES)

    expect((await adapter.expand('subseries:vengeance')).items).toEqual([
      { title: 'Vengeance (2001)', year: 2001 },
    ])
    expect((await adapter.expand('subseries:vengeance-day')).items).toEqual([
      { title: 'Vengeance Day (2023)', year: 2023 },
    ])
  })

  it('the In Your House sub-series covers subtitled editions but not the unrelated TakeOver: In Your House', async () => {
    const wikitext = [
      '==1996==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|February 18',
      '|In Your House',
      '|-',
      '|April 28',
      '|In Your House: Beware of Dog',
      '|}',
      '==2020==',
      '{| class="wikitable"',
      '! Date !! Event',
      '|-',
      '|June 20',
      '|TakeOver: In Your House',
      '|}',
    ].join('\n')

    const adapter = createWikipediaEventsAdapter([WWE], respondWith(wikitext), WWE_SUB_SERIES)

    expect((await adapter.expand('subseries:in-your-house')).items).toEqual([
      { title: 'In Your House (1996)', year: 1996 },
      { title: 'In Your House: Beware of Dog (1996)', year: 1996 },
    ])
  })

  it('returns nothing when a sub-series is known but its promotion is not in this adapter instance', async () => {
    // ufc-numbered's promotionKey is 'ufc', but only WWE is configured here —
    // the mma media type's promotions, not wrestling's.
    const adapter = createWikipediaEventsAdapter([WWE], respondWith(''), UFC_SUB_SERIES)

    expect((await adapter.expand('subseries:ufc-numbered')).items).toEqual([])
  })
})

describe('rows that miss a cell', () => {
  const table = (headers: string, ...rows: string[]) =>
    ['==Past events==', '{| class="wikitable"', headers, ...rows.flatMap((row) => ['|-', row]), '|}'].join('\n')

  it('keeps an event whose last cell was left out, a card just held with no attendance yet', async () => {
    // Checked live: UFC Freedom 250 (June 2026), 37 more UFC events, two WWE 2026 shows and a TNA one were dropped.
    const wikitext = table(
      '! # !! Event !! Date !! Attendance',
      '|1\n|[[UFC 1]]\n|{{dts|1993|Nov|12}}\n|15,000',
      '|2\n|[[UFC Freedom 250]]\n|{{dts|2026|Jun|14}}',
    )

    const items = (await createWikipediaEventsAdapter([UFC], respondWith(wikitext)).expand('promotion:ufc')).items

    expect(items).toEqual([
      { title: 'UFC 1', year: 1993 },
      { title: 'UFC Freedom 250', year: 2026 },
    ])
  })

  it('still skips a legend line and a row that misses more than one cell', async () => {
    const wikitext = table(
      '! Date !! Event !! Venue !! Attendance',
      '|colspan=4|{{center|(c) – refers to the champion}}',
      '|May 9\n|[[Backlash]]',
      '|May 31\n|[[Clash in Italy]]\n|[[Inalpi Arena]]\n|12,977',
    )

    const items = (await createWikipediaEventsAdapter([WWE], respondWith(wikitext)).expand('promotion:wwe')).items

    expect(items.map((item) => item.title)).toEqual(['Clash in Italy'])
  })

  it('skips a short row that never reached the event column', async () => {
    const wikitext = table(
      '! Date !! Venue !! Location !! Event',
      '|2026\n|[[Arena]]\n|[[Tampa]]',
      '|2025\n|[[Arena]]\n|[[Tampa]]\n|[[Some Show]]',
    )

    const items = (await createWikipediaEventsAdapter([WWE], respondWith(wikitext)).expand('promotion:wwe')).items

    expect(items.map((item) => item.title)).toEqual(['Some Show'])
  })
})

describe('when Wikipedia cannot give the page', () => {
  const answer = (body: unknown, status = 200): FetchLike => vi.fn(async () => new Response(JSON.stringify(body), { status }))

  it('says so for a page that does not exist, rather than offering a promotion with no events', async () => {
    const adapter = createWikipediaEventsAdapter(
      [UFC],
      answer({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } }),
    )

    const error = await adapter.expand('promotion:ufc').catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(IngestionError)
    expect((error as Error).message).toBe(`Wikipedia could not give "List of UFC events": The page you specified doesn't exist.`)
  })

  it('names the error code when Wikipedia gives no sentence, and says so for an answer with no text', async () => {
    await expect(createWikipediaEventsAdapter([UFC], answer({ error: { code: 'badtitle' } })).expand('promotion:ufc')).rejects.toThrow(
      /badtitle/,
    )
    await expect(createWikipediaEventsAdapter([UFC], answer({ error: {} })).expand('promotion:ufc')).rejects.toThrow(/unknown error/)
    await expect(createWikipediaEventsAdapter([UFC], answer({ parse: {} })).expand('promotion:ufc')).rejects.toThrow(
      /returned no text for "List of UFC events"/,
    )
  })

  it('fails a sub-series the same way, not as an empty list', async () => {
    const adapter = createWikipediaEventsAdapter([WWE], answer({ error: { code: 'missingtitle', info: 'gone' } }), WWE_SUB_SERIES)

    await expect(adapter.expand('subseries:wrestlemania')).rejects.toThrow(IngestionError)
  })

  it('tries a 503 again, and waits as long as a 429 asks', async () => {
    noWait.mockClear()
    let seen = 0
    const fetchImpl: FetchLike = vi.fn(async () => {
      seen += 1
      if (seen === 1) return new Response('{}', { status: 503 })
      if (seen === 2) return new Response('{}', { status: 429, headers: { 'retry-after': '3' } })

      return new Response(JSON.stringify({ parse: { wikitext: { '*': '==Past events==\n{| class="wikitable"\n! Event !! Date\n|-\n|[[UFC 1]]\n|{{dts|1993|Nov|12}}\n|}' } } }))
    })

    const { items } = await createWikipediaEventsAdapter([UFC], fetchImpl, [], { sleep: noWait }).expand('promotion:ufc')

    expect(items).toHaveLength(1)
    expect(noWait.mock.calls.map(([ms]) => ms)).toEqual([500, 3000])
  })

  it('gives up after three tries, and does not try a 404 again', async () => {
    const busy = answer({}, 503)
    await expect(createWikipediaEventsAdapter([UFC], busy, [], { sleep: noWait }).expand('promotion:ufc')).rejects.toThrow(
      /Wikipedia returned 503/,
    )
    expect(busy).toHaveBeenCalledTimes(3)

    const missing = answer({}, 404)
    await expect(createWikipediaEventsAdapter([UFC], missing, [], { sleep: noWait }).expand('promotion:ufc')).rejects.toThrow(
      IngestionError,
    )
    expect(missing).toHaveBeenCalledTimes(1)
  })
})

describe('reading one page for many rows', () => {
  const page = ['==1985==', '{| class="wikitable"', '! Date !! Event', '|-', '|March 31', '|[[WrestleMania I|WrestleMania]]', '|-', '|July 1', '|[[Royal Rumble]]', '|}'].join('\n')

  it('reads a page once for every sub-series of it, and each still gets its own events', async () => {
    const fetchImpl = respondWith(page)
    const adapter = createWikipediaEventsAdapter([WWE], fetchImpl, WWE_SUB_SERIES, { cache: createPageCache() })

    const mania = await adapter.expand('subseries:wrestlemania')
    const rumble = await adapter.expand('subseries:royal-rumble')
    const all = await adapter.expand('promotion:wwe')

    expect(mania.items.map((item) => item.title)).toEqual(['WrestleMania (1985)'])
    expect(rumble.items.map((item) => item.title)).toEqual(['Royal Rumble (1985)'])
    expect(all.items).toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('asks again for every listing when it was given its own fetch and no cache', async () => {
    const fetchImpl = respondWith(page)
    const adapter = createWikipediaEventsAdapter([WWE], fetchImpl, WWE_SUB_SERIES)

    await adapter.expand('subseries:wrestlemania')
    await adapter.expand('subseries:royal-rumble')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('shares one request between listings asked for at the same moment', async () => {
    const fetchImpl = respondWith(page)
    const adapter = createWikipediaEventsAdapter([WWE], fetchImpl, WWE_SUB_SERIES, { cache: createPageCache() })

    await Promise.all(['wrestlemania', 'royal-rumble', 'summerslam'].map((key) => adapter.expand(`subseries:${key}`)))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  describe('the page cache', () => {
    const events = () => [{ title: 'A', year: 1990, tags: ['x'] }]

    it('remembers a page for a minute, then reads it again', async () => {
      let time = 0
      const cache = createPageCache(60_000, () => time)
      const load = vi.fn(async () => events())

      await cache.get('p', load)
      time = 59_999
      await cache.get('p', load)
      expect(load).toHaveBeenCalledTimes(1)

      time = 60_000
      await cache.get('p', load)
      expect(load).toHaveBeenCalledTimes(2)
    })

    it('keeps each page apart', async () => {
      const cache = createPageCache()
      const load = vi.fn(async () => events())

      await cache.get('one', load)
      await cache.get('two', load)

      expect(load).toHaveBeenCalledTimes(2)
    })

    it('does not remember a failure: the next ask tries again', async () => {
      const cache = createPageCache()
      const load = vi.fn<() => Promise<{ title: string }[]>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue(events())

      await expect(cache.get('p', load)).rejects.toThrow('down')
      await expect(cache.get('p', load)).resolves.toHaveLength(1)
      expect(load).toHaveBeenCalledTimes(2)
    })

    it('hands out copies, so one asker changing its events changes nobody else’s', async () => {
      const cache = createPageCache()
      const first = await cache.get('p', async () => events())

      first[0]!.title = 'changed'
      first[0]!.tags!.push('y')
      const second = await cache.get('p', async () => events())

      expect(second).toEqual([{ title: 'A', year: 1990, tags: ['x'] }])
    })
  })
})

describe('sections that are not events held', () => {
  const year = new Date().getFullYear()
  const table = (name: string, date: string) =>
    ['{| class="wikitable"', '! Date !! Event', '|-', `|${date}`, `|[[${name}]]`, '|}']
  const page = (...parts: string[][]) => parts.flat().join('\n')

  it('skips the year sections inside "Upcoming event schedule", which hold shows not yet held', async () => {
    // Checked live: WWE's Survivor Series, AEW's Full Gear, TNA's Bound for Glory were offered as events to watch.
    const wikitext = page(
      [`==${year - 1}==`],
      table('Held Show', 'March 1'),
      [`==${year}==`],
      table('Held This Year', 'April 1'),
      ['==Upcoming event schedule==', `===${year}===`],
      table('Survivor Series', 'November 28'),
      [`===${year}===`, '====A deeper one===='],
      table('Deeper', 'December 5'),
      ['==Number of events by year=='],
      table('A Year Row', 'x'),
    )

    const items = (await createWikipediaEventsAdapter([WWE], respondWith(wikitext)).expand('promotion:wwe')).items

    expect(items.map((item) => item.title)).toEqual([`Held Show (${year - 1})`, `Held This Year (${year})`])
  })

  it('goes on with the next section of the same depth, or a shallower one, after skipping one', async () => {
    const wikitext = page(
      ['==Upcoming events=='],
      table('Skipped One', 'May 1'),
      ['===Detail==='],
      table('Skipped Two', 'May 2'),
      ['==Past events=='],
      table('Kept One', 'June 1'),
      ['==Scheduled events==', '===Next==='],
      table('Skipped Three', 'July 1'),
      ['==Earlier events=='],
      table('Kept Two', 'August 1'),
    )

    const items = (await createWikipediaEventsAdapter([UFC], respondWith(wikitext)).expand('promotion:ufc')).items

    expect(items.map((item) => item.title)).toEqual(['Kept One', 'Kept Two'])
  })

  it('keeps the subsections of a section that is held, even after a skipped one', async () => {
    const wikitext = page(['==Upcoming events=='], table('Skipped', 'May 1'), ['==Past events==', '===By decade==='], table('Kept Deep', 'June 1'))

    const items = (await createWikipediaEventsAdapter([UFC], respondWith(wikitext)).expand('promotion:ufc')).items

    expect(items.map((item) => item.title)).toEqual(['Kept Deep'])
  })

  it('skips what is inside a commentary section too, not only its own table', async () => {
    const wikitext = page(['==Themed events==', '===Halloween==='], table('Themed Show', 'October 31'), ['==Past events=='], table('Real Show', 'May 1'))

    const items = (await createWikipediaEventsAdapter([UFC], respondWith(wikitext)).expand('promotion:ufc')).items

    expect(items.map((item) => item.title)).toEqual(['Real Show'])
  })
})
