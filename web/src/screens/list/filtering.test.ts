import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'
import { NO_FILTER, isFiltering, shownItemIds, type ListFilter } from './filtering.js'

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
