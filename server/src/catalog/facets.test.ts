import { describe, expect, it } from 'vitest'
import {
  UNTAGGED,
  deriveFacets,
  tagSummary,
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

  it('orders platforms by code, A to Z (unknown codes among them), then Untagged (owner, 2026-09-27)', () => {
    // A bare `multi` is no longer a claim (owner, U5): just a code the table does not know.
    const items = [item('multi'), item('Some Box'), item('WIN'), item(), item('PS3'), item('X360')]
    expect(options(platform, items, 'platform')).toEqual(['MULTI', 'PS3', 'SOME BOX', 'WIN', 'X360', 'Untagged'])
  })

  it('lists each platform of a mixed-tag item separately (Assassin’s Creed)', () => {
    const items = [item('PS3', 'X360', 'WIN'), item('DS'), item('PSP')]
    expect(options(platform, items, 'platform')).toEqual(['DS', 'PS3', 'PSP', 'WIN', 'X360'])
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

/**
 * Music's Type (owner, 2026-09-27): one of Album, Mini (EP or Single, as the
 * source wrote it), Compilation, which prevails over the other two; Live is a
 * flag on top, filtered as its own facet so Album + Live means live albums.
 */
describe('a main value with aliases, a prevailing value, and a flag', () => {
  const MUSIC: FacetConvention = [
    {
      key: 'type',
      label: 'Type',
      keepOrder: true,
      prevails: 'Compilation',
      values: ['Album', { tag: 'Mini', label: 'Mini', aliases: ['EP', 'Single'] }, 'Compilation'],
    },
    { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
  ]

  it('reads EP and Single as Mini, once, whatever the case', () => {
    expect(options(MUSIC, [item('EP'), item('single'), item('Mini')], 'type')).toEqual(['Mini'])
    expect(options(MUSIC, [item('EP', 'Single')], 'type')).toEqual(['Mini'])
  })

  it('counts a compilation as a Compilation only, not also an Album', () => {
    expect(options(MUSIC, [item('Album', 'Compilation')], 'type')).toEqual(['Compilation'])
    const albums: FacetSelection = { type: new Set(['album']) }
    expect(matchesFacets(item('Album', 'Compilation'), MUSIC, albums)).toBe(false)
    expect(matchesFacets(item('Album', 'Live'), MUSIC, albums)).toBe(true)
  })

  it('offers the flag as its own facet, without an Untagged button, and only when an item has it', () => {
    expect(deriveFacets([item('Album', 'Live'), item('EP')], MUSIC).map((facet) => facet.key)).toEqual(['type', 'extra'])
    expect(options(MUSIC, [item('Album', 'Live'), item('EP')], 'extra')).toEqual(['Live'])
    expect(deriveFacets([item('Album', 'Live')], MUSIC).map((facet) => facet.flag ?? false)).toEqual([false, true])
    expect(deriveFacets([item('Album'), item('EP')], MUSIC).map((facet) => facet.key)).toEqual(['type'])
  })

  it('narrows to live albums when Album and Live are both on', () => {
    const liveAlbums: FacetSelection = { type: new Set(['album']), extra: new Set(['live']) }
    expect(matchesFacets(item('Album', 'Live'), MUSIC, liveAlbums)).toBe(true)
    expect(matchesFacets(item('Album'), MUSIC, liveAlbums)).toBe(false)
    expect(matchesFacets(item('EP', 'Live'), MUSIC, liveAlbums)).toBe(false)
  })

  it('counts an item with only Live as untagged for Type', () => {
    expect(options(MUSIC, [item('Live'), item('Album')], 'type')).toEqual(['Album', 'Untagged'])
  })

  it('says whether a facet keeps its written order; platforms keep theirs, the rest go A–Z where shown', () => {
    const groups = deriveFacets([item('Album', 'Live')], MUSIC)
    expect(groups.map((facet) => facet.keepOrder)).toEqual([true, false])
    expect(deriveFacets([item('PS3')], platform)[0]!.keepOrder).toBe(true)
    expect(deriveFacets([item('English')], books)[0]!.keepOrder).toBe(false)
  })

  it('sums an item up for the tag column: the main value, then the flag', () => {
    expect(tagSummary(['EP', 'Live'], MUSIC)).toBe('Mini · Live')
    expect(tagSummary(['Album', 'Compilation'], MUSIC)).toBe('Compilation')
    expect(tagSummary(['Live'], MUSIC)).toBe('Live')
    expect(tagSummary(['Split', 'EP'], MUSIC)).toBe('Mini')
  })

  it('falls back to the first tag as written when no value names any, and to nothing without tags', () => {
    expect(tagSummary(['Remix'], MUSIC)).toBe('Remix')
    expect(tagSummary(['GAME'], [{ key: 'type', label: 'Medium', values: [{ tag: 'game', label: 'Game' }] }])).toBe('Game')
    expect(tagSummary(['English'], books)).toBe('English')
    expect(tagSummary(null, MUSIC)).toBeUndefined()
    expect(tagSummary([], MUSIC)).toBeUndefined()
  })
})
