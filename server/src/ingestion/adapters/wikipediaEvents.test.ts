import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { createWikipediaEventsAdapter, type Promotion } from './wikipediaEvents.js'

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

    expect(await adapter.expand('promotion:ufc')).toEqual([
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

    expect(await adapter.expand('promotion:wwe')).toEqual([
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

    expect(await adapter.expand('promotion:ufc')).toEqual([{ title: 'Some Card' }])
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

    expect(await adapter.expand('promotion:wwe')).toEqual([
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

    expect(await adapter.expand('promotion:ufc')).toEqual([
      { title: 'UFC 1', year: 1993 },
      { title: 'Some Card' },
      { title: 'UFC 2', year: 1994 },
    ])
  })
})
