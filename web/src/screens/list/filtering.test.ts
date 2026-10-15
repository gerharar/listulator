import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'
import { NO_FILTER, isFiltering, noteOnlyMatch, shownItemIds, type ListFilter } from './filtering.js'

const item = (id: string, title: string, tags: string[] | null = null, consumedAt: string | null = null): ListItem =>
  ({ id, title, tags, consumedAt }) as ListItem

const games: FacetConvention = [{ key: 'platform', label: 'Platform' }]
const items = [
  item('1', 'Assassin’s Creed', ['PS3', 'X360', 'PC']),
  item('2', 'Altaïr’s Chronicles', ['NDS']),
  item('3', 'Revelations', ['multi']),
  item('4', 'Unmarked'),
]
const ids = (filter: ListFilter) => [...shownItemIds(items, games, filter)]

describe('isFiltering', () => {
  it('is false for the empty filter, blank text, and facets with nothing selected', () => {
    expect(isFiltering(NO_FILTER)).toBe(false)
    expect(isFiltering({ text: '   ', facets: {} })).toBe(false)
    expect(isFiltering({ text: '', facets: { platform: new Set() } })).toBe(false)
  })

  it('is true for text or any selected facet option', () => {
    expect(isFiltering({ text: 'a', facets: {} })).toBe(true)
    expect(isFiltering({ text: '', facets: { platform: new Set(['ps3']) } })).toBe(true)
  })
})

describe('shownItemIds', () => {
  it('shows everything when there is no filter', () => {
    expect(ids(NO_FILTER)).toEqual(['1', '2', '3', '4'])
  })

  it('matches the title, ignoring case and surrounding spaces', () => {
    expect(ids({ text: '  CREED ', facets: {} })).toEqual(['1'])
  })

  it('does not match on tags', () => {
    expect(ids({ text: 'ps3', facets: {} })).toEqual([])
  })

  it('matches an item when any selected facet option is among its tags', () => {
    expect(ids({ text: '', facets: { platform: new Set(['ds', 'win']) } })).toEqual(['1', '2'])
  })

  it('finds untagged items through Untagged', () => {
    expect(ids({ text: '', facets: { platform: new Set(['__untagged']) } })).toEqual(['4'])
  })

  it('needs the text and the facets to agree', () => {
    expect(ids({ text: 'creed', facets: { platform: new Set(['ds']) } })).toEqual([])
    expect(ids({ text: 'a', facets: { platform: new Set(['ds']) } })).toEqual(['2'])
  })

  it('ignores a facet selection when the category has no convention', () => {
    const filter = { text: '', facets: { platform: new Set(['ds']) } }
    expect([...shownItemIds(items, undefined, filter)]).toEqual(['1', '2', '3', '4'])
  })
})

describe('Hide Completed (18.1)', () => {
  const mixed = [
    item('1', 'Assassin’s Creed', ['PS3'], '2026-01-01'),
    item('2', 'Altaïr’s Chronicles', ['NDS']),
    item('3', 'Revelations', ['PS3'], '2026-01-02'),
    item('4', 'Unmarked'),
  ]
  const hidden = (filter: ListFilter, keep?: ReadonlySet<string>) => [...shownItemIds(mixed, games, filter, keep)]

  it('counts as filtering on its own', () => {
    expect(isFiltering({ text: '', facets: {}, hideDone: true })).toBe(true)
    expect(isFiltering({ text: '', facets: {}, hideDone: false })).toBe(false)
  })

  it('hides every done item', () => {
    expect(hidden({ text: '', facets: {}, hideDone: true })).toEqual(['2', '4'])
  })

  it('needs the text and the facets to agree as well', () => {
    expect(hidden({ text: 'a', facets: { platform: new Set(['ds']) }, hideDone: true })).toEqual(['2'])
    expect(hidden({ text: 'creed', facets: {}, hideDone: true })).toEqual([])
  })

  it('keeps the items ticked during this visit', () => {
    expect(hidden({ text: '', facets: {}, hideDone: true }, new Set(['3']))).toEqual(['2', '3', '4'])
  })

  it('shows done items while it is off', () => {
    expect(hidden({ text: '', facets: {}, hideDone: false })).toEqual(['1', '2', '3', '4'])
  })
})

describe('the filter searches notes too (H-003)', () => {
  const noted = [
    { ...item('1', 'Crime Story', ['PS3']), notes: 'Watch the Cantonese cut.', userNote: null },
    { ...item('2', 'Heat'), notes: null, userNote: 'Seen it with Mira' },
    { ...item('3', 'Collateral'), notes: '  ', userNote: null },
    { ...item('4', 'Ronin'), notes: 'Mira would love it', userNote: 'Cantonese? No.' },
    { ...item('5', 'Cantonese Kitchen'), notes: null, userNote: null },
  ] as ListItem[]
  const shown = (filter: ListFilter, keep?: ReadonlySet<string>) => [...shownItemIds(noted, games, filter, keep)]

  it('shows an item whose curator note has the text, ignoring case and surrounding spaces', () => {
    expect(shown({ text: ' WATCH the ', facets: {} })).toEqual(['1'])
  })

  it('shows an item whose own note has the text', () => {
    expect(shown({ text: 'seen it', facets: {} })).toEqual(['2'])
  })

  it('shows an item for its title, its curator note or its own note, each on its own', () => {
    expect(shown({ text: 'cantonese', facets: {} })).toEqual(['1', '4', '5'])
    expect(shown({ text: 'mira', facets: {} })).toEqual(['2', '4'])
  })

  it('does not match a blank note, and a note never matches an empty filter by itself', () => {
    expect(shown({ text: 'x ', facets: {} })).toEqual([])
    expect(shown(NO_FILTER)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('still needs the facets and Hide Completed to agree with a note match', () => {
    expect(shown({ text: 'cantonese', facets: { platform: new Set(['ps3']) } })).toEqual(['1'])
    const done = noted.map((entry) => (entry.id === '1' ? { ...entry, consumedAt: 'x' } : entry))
    expect([...shownItemIds(done, games, { text: 'cantonese', facets: {}, hideDone: true })]).toEqual(['4', '5'])
  })
})

describe('noteOnlyMatch: which note lights the ⓘ', () => {
  const row = (title: string, notes: string | null, userNote: string | null) => ({ title, notes, userNote }) as ListItem

  it('is nothing for no text', () => {
    expect(noteOnlyMatch(row('Heat', 'x', 'y'), '')).toBeNull()
    expect(noteOnlyMatch(row('Heat', 'x', 'y'), '   ')).toBeNull()
  })

  it('is nothing when the title matches: a title match looks as it does today, even if a note matches too', () => {
    expect(noteOnlyMatch(row('Heat', 'a heat wave', null), 'heat')).toBeNull()
  })

  it('is the curator’s note when only it has the text', () => {
    expect(noteOnlyMatch(row('Heat', 'Watch the Cantonese cut', 'Mira'), ' CANTONESE')).toBe('curator')
  })

  it('is the user’s note when it has the text, alone or with the curator’s', () => {
    expect(noteOnlyMatch(row('Heat', null, 'Seen it with Mira'), 'mira')).toBe('mine')
    expect(noteOnlyMatch(row('Heat', 'Mira says so', 'Seen it with Mira'), 'mira')).toBe('mine')
  })

  it('is nothing when no note has the text', () => {
    expect(noteOnlyMatch(row('Heat', 'a', 'b'), 'zzz')).toBeNull()
    expect(noteOnlyMatch(row('Heat', null, null), 'a')).toBeNull()
  })
})

describe('the typed text is matched as typed, not as a pattern', () => {
  const rows = [
    { ...item('1', 'Heat (1995)'), notes: 'a.b', userNote: null },
    { ...item('2', 'Ronin'), notes: null, userNote: 'axb [draft]' },
  ] as ListItem[]
  const shown = (text: string) => [...shownItemIds(rows, undefined, { text, facets: {} })]

  it('treats . ( [ * as the characters they are, in titles and notes, and never throws', () => {
    expect(shown('a.b')).toEqual(['1'])
    expect(shown('(1995)')).toEqual(['1'])
    expect(shown('[draft]')).toEqual(['2'])
    expect(shown('.*')).toEqual([])
    expect(shown('(')).toEqual(['1'])
  })
})

