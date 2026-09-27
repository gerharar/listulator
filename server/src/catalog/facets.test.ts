import { describe, expect, it } from 'vitest'
import {
  UNTAGGED,
  deriveFacets,
  displayTag,
  matchesFacets,
  type FacetConvention,
  type FacetSelection,
} from './facets.js'

const item = (...tags: string[]) => ({ tags: tags.length ? tags : null })

const platform: FacetConvention = [{ key: 'platform', label: 'Platform' }]
const music: FacetConvention = [
  { key: 'type', label: 'Type', values: ['Album', 'EP', 'Single', 'Live', 'Compilation'] },
]
const books: FacetConvention = [{ key: 'language', label: 'Language', noValue: ['Unknown'] }]

function options(convention: FacetConvention, items: ReturnType<typeof item>[], facet: string) {
  return deriveFacets(items, convention)
    .find((entry) => entry.key === facet)
    ?.options.map((option) => option.label)
}

describe('deriveFacets', () => {
  it('gives no facets to a category without a convention', () => {
    expect(deriveFacets([item('PS3'), item('Album')], undefined)).toEqual([])
    expect(deriveFacets([item('PS3')], [])).toEqual([])
  })

  it('shows a facet as soon as one item carries a matching tag', () => {
    expect(options(platform, [item('PS3')], 'platform')).toEqual(['PS3'])
  })

  it('hides a facet when no item carries a matching tag', () => {
    expect(deriveFacets([item(), item()], platform)).toEqual([])
    expect(deriveFacets([item('Podcast')], music)).toEqual([])
  })

  it('orders platforms by code, A to Z (unknown codes among them), then MULTI, then Untagged (owner, 2026-09-27)', () => {
    const items = [item('multi'), item('Some Box'), item('WIN'), item(), item('PS3'), item('X360')]
    expect(options(platform, items, 'platform')).toEqual([
      'PS3',
      'SOME BOX',
      'WIN',
      'X360',
      'MULTI',
      'Untagged',
    ])
  })

  it('lists each platform of a mixed-tag item separately (Assassin’s Creed)', () => {
    const items = [item('PS3', 'X360', 'WIN'), item('DS'), item('PSP'), item('multi')]
    expect(options(platform, items, 'platform')).toEqual(['DS', 'PS3', 'PSP', 'WIN', 'X360', 'MULTI'])
  })

  it('reads a code written before the table as today’s: a PC item and a WIN item share one WIN button (10.24c)', () => {
    const items = [item('PC'), item('WIN'), item('NDS')]

    expect(options(platform, items, 'platform')).toEqual(['DS', 'WIN'])
    const selection: FacetSelection = { platform: new Set(['win']) }
    expect(items.map((entry) => matchesFacets(entry, platform, selection))).toEqual([true, true, false])
  })

  it('shows a code in the table’s capitals whatever the tag’s case', () => {
    expect(options(platform, [item('firetv')], 'platform')).toEqual(['FIRETV'])
  })

  it('sorts character by character, digits before letters, as a reader scanning the codes expects', () => {
    expect(options(platform, [item('NES'), item('3DS'), item('32X'), item('A2600')], 'platform')).toEqual([
      '32X',
      '3DS',
      'A2600',
      'NES',
    ])
  })

  it('matches platform codes case-insensitively and counts one code once', () => {
    expect(options(platform, [item('ps3'), item('PS3')], 'platform')).toEqual(['PS3'])
  })

  it('offers only the languages present, in first-seen order, never a hardcoded list', () => {
    const items = [item('Russian'), item('English'), item('Russian'), item()]
    expect(options(books, items, 'language')).toEqual(['Russian', 'English', 'Untagged'])
  })

  it('folds an Unknown language into Untagged', () => {
    expect(options(books, [item('English'), item('Unknown')], 'language')).toEqual([
      'English',
      'Untagged',
    ])
  })

  it('keeps a convention’s own order and spelling for its known values', () => {
    const items = [item('live', 'Album'), item('EP'), item('Album')]
    expect(options(music, items, 'type')).toEqual(['Album', 'EP', 'Live'])
  })

  it('ignores tags that are not among a facet’s known values', () => {
    expect(options(music, [item('Album', 'Bootleg')], 'type')).toEqual(['Album'])
  })

  it('offers Untagged only when some item lacks a matching tag', () => {
    expect(options(music, [item('Album'), item('EP')], 'type')).toEqual(['Album', 'EP'])
    expect(options(music, [item('Album'), item('Bootleg')], 'type')).toEqual(['Album', 'Untagged'])
  })
})

describe('values with a display name apart from the tag', () => {
  const medium: FacetConvention = [
    {
      key: 'type',
      label: 'Medium',
      values: [
        { tag: 'movie', label: 'Movie' },
        { tag: 'tv', label: 'TV' },
        { tag: 'game', label: 'Game' },
      ],
    },
  ]

  it('matches the tag as written in the list file and shows the display name', () => {
    expect(options(medium, [item('game'), item('MOVIE'), item('tv', 'movie')], 'type')).toEqual(['Movie', 'TV', 'Game'])
  })

  it('selects by the tag, whatever its spelling', () => {
    expect(matchesFacets(item('Game'), medium, { type: new Set(['game']) })).toBe(true)
    expect(matchesFacets(item('movie'), medium, { type: new Set(['game']) })).toBe(false)
  })

  it('ignores a tag that names none of the values', () => {
    expect(options(medium, [item('game'), item('podcast')], 'type')).toEqual(['Game', 'Untagged'])
  })
})

describe('matchesFacets', () => {
  const select = (facet: string, ...keys: string[]): FacetSelection => ({ [facet]: new Set(keys) })

  it('matches everything when nothing is selected', () => {
    expect(matchesFacets(item('PS3'), platform, {})).toBe(true)
    expect(matchesFacets(item(), platform, select('platform'))).toBe(true)
  })

  it('matches when any selected tag is among the item’s', () => {
    const ac = item('PS3', 'X360', 'PC')
    expect(matchesFacets(ac, platform, select('platform', 'ps3'))).toBe(true)
    // Selections carry the buttons' keys, which read old codes as today's: PC is win.
    expect(matchesFacets(ac, platform, select('platform', 'ds', 'win'))).toBe(true)
    expect(matchesFacets(ac, platform, select('platform', 'ds'))).toBe(false)
  })

  it('does not treat a named-platform item as MULTI, nor a bare multi as any platform', () => {
    expect(matchesFacets(item('PS3', 'X360'), platform, select('platform', 'multi'))).toBe(false)
    expect(matchesFacets(item('multi'), platform, select('platform', 'ps3'))).toBe(false)
    expect(matchesFacets(item('multi'), platform, select('platform', 'multi'))).toBe(true)
  })

  it('matches an untagged item only when Untagged is selected', () => {
    expect(matchesFacets(item(), platform, select('platform', 'ps3'))).toBe(false)
    expect(matchesFacets(item(), platform, select('platform', UNTAGGED))).toBe(true)
    expect(matchesFacets(item('PS3'), platform, select('platform', UNTAGGED))).toBe(false)
  })

  it('treats Unknown as untagged when matching a language', () => {
    expect(matchesFacets(item('Unknown'), books, select('language', UNTAGGED))).toBe(true)
  })

  it('requires every facet with a selection to match', () => {
    const both: FacetConvention = [...music, ...books]
    const selection: FacetSelection = { type: new Set(['album']), language: new Set(['english']) }
    expect(matchesFacets(item('Album', 'English'), both, selection)).toBe(true)
    expect(matchesFacets(item('Album', 'French'), both, selection)).toBe(false)
  })
})

describe('displayTag (the tag column reads through the same map as the facet)', () => {
  const medium: FacetConvention = [
    { key: 'type', label: 'Medium', values: [{ tag: 'game', label: 'Game' }, 'EP'] },
  ]

  it('shows a value\u2019s display name whatever the tag\u2019s spelling', () => {
    expect(displayTag('GAME', medium)).toBe('Game')
    expect(displayTag('ep', medium)).toBe('EP')
  })

  it('leaves a tag no value names as it is written', () => {
    expect(displayTag('podcast', medium)).toBe('podcast')
    expect(displayTag('PS3', undefined)).toBe('PS3')
  })
})
