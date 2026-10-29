import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'
import { NO_FILTER, isFiltering, isMatchFiltering, matchedCount, noteOnlyMatch, shownItemIds, type ListFilter } from './filtering.js'

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

describe('the filter searches a row’s group name too (owner, 2026-10-29)', () => {
  const grouped = (id: string, title: string, group: string | null, consumedAt: string | null = null): ListItem =>
    ({ ...item(id, title, null, consumedAt), group, notes: null, userNote: null }) as ListItem
  const episodes = [
    grouped('1', 'S01E01 Snow Gives Way', 'Iron Fist: Season 1'),
    grouped('2', 'S01E02 Shadow Hawk Takes Flight', 'Iron Fist: Season 1', 'x'),
    grouped('3', 'S02E01 The Fury of Iron Fist', 'Iron Fist: Season 2'),
    grouped('4', 'S01E01 The H Word', 'The Defenders'),
    grouped('5', 'Iron Fist: the movie that is not', null),
    grouped('6', 'Loose film', null),
  ]
  const shown = (filter: ListFilter, rows: readonly ListItem[] = episodes, convention: FacetConvention | undefined = undefined) => [
    ...shownItemIds(rows, convention, filter),
  ]

  it('shows every row of a group whose name has the text, though no title does', () => {
    expect(shown({ text: 'iron fist', facets: {} })).toEqual(['1', '2', '3', '5'])
  })

  it('ignores case and surrounding spaces, as for a title', () => {
    expect(shown({ text: '  SEASON 1 ', facets: {} })).toEqual(['1', '2'])
  })

  it('leaves out the rows of other groups and the loose rows with no group', () => {
    expect(shown({ text: 'defenders', facets: {} })).toEqual(['4'])
    expect(shown({ text: 'loose', facets: {} })).toEqual(['6'])
  })

  it('treats a group name with pattern characters as the characters they are', () => {
    const rows = [grouped('1', 'One', 'Vol. (1) [x]'), grouped('2', 'Two', 'Vol 2')]

    expect(shown({ text: '(1) [x]', facets: {} }, rows)).toEqual(['1'])
    expect(shown({ text: 'vol.', facets: {} }, rows)).toEqual(['1'])
    expect(shown({ text: '.*', facets: {} }, rows)).toEqual([])
  })

  it('copes with a row whose group is missing', () => {
    const rows = [{ ...item('1', 'Plain row') }, grouped('2', 'Kept', 'Kept group')]

    expect(shown({ text: 'group', facets: {} }, rows)).toEqual(['2'])
  })

  it('still needs the facets and Hide Completed to agree with a group-name match', () => {
    const tagged = episodes.map((entry) => (entry.id === '1' ? { ...entry, tags: ['PS3'] } : entry)) as ListItem[]

    expect(shown({ text: 'season 1', facets: { platform: new Set(['ps3']) } }, tagged, games)).toEqual(['1'])
    expect(shown({ text: 'season 1', facets: {}, hideDone: true })).toEqual(['1'])
  })

  it('leaves no “N shown” on a group the text matches whole, and counts the rest as before', () => {
    const season1 = episodes.filter((entry) => entry.group === 'Iron Fist: Season 1')
    const matching = new Set(shown({ text: 'season 1', facets: {} }))
    const partial = episodes.filter((entry) => entry.group === 'Iron Fist: Season 2').concat(grouped('7', 'Other', 'Iron Fist: Season 2'))

    expect(matchedCount(season1, matching)).toBeUndefined()
    expect(matchedCount(partial, new Set(shown({ text: 'fury', facets: {} }, partial)))).toBe(1)
  })

  it('does not change which note lights the ⓘ', () => {
    expect(noteOnlyMatch(episodes[0]!, 'iron fist')).toBeNull()
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


describe('what a group header says under a filter (H-010)', () => {
  const row = (id: string): ListItem => ({ id, title: id }) as ListItem

  it('Hide Completed is not a matching filter; text and a facet are', () => {
    expect(isMatchFiltering(NO_FILTER)).toBe(false)
    expect(isMatchFiltering({ ...NO_FILTER, hideDone: true })).toBe(false)
    expect(isMatchFiltering({ ...NO_FILTER, text: ' a ' })).toBe(true)
    expect(isMatchFiltering({ ...NO_FILTER, text: '  ' })).toBe(false)
    expect(isMatchFiltering({ ...NO_FILTER, facets: { platform: new Set(['PC']) } })).toBe(true)
    expect(isMatchFiltering({ ...NO_FILTER, facets: { platform: new Set() } })).toBe(false)
  })

  it('counts the group\'s rows a filter leaves, and says nothing when it leaves them all', () => {
    const items = [row('a'), row('b'), row('c'), row('d')]

    expect(matchedCount(items, new Set(['a', 'c', 'x']))).toBe(2)
    expect(matchedCount(items, new Set())).toBe(0)
    expect(matchedCount(items, new Set(['a', 'b', 'c', 'd']))).toBeUndefined()
    expect(matchedCount([], new Set(['a']))).toBeUndefined()
  })
})
