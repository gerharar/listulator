import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import {
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
