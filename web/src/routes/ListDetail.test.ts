import { describe, expect, it } from 'vitest'
import { groupItems, moveItem, moveItemTo } from './ListDetail.js'
import type { ListItem } from '../lib/api.js'

let nextId = 0

function item(overrides: Partial<ListItem> = {}): ListItem {
  nextId += 1

  return {
    id: `item-${nextId}`,
    listId: 'list-1',
    title: `Item ${nextId}`,
    orderIndex: nextId,
    timeToConsumeMinutes: 30,
    timeToConsumeIsEstimated: true,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    isNew: false,
    ...overrides,
  }
}

describe('groupItems', () => {
  it('renders a flat list unaffected when no item has a group', () => {
    const items = [item(), item(), item()]

    expect(groupItems(items)).toEqual(items.map((entry) => ({ kind: 'item', item: entry })))
  })

  it('folds consecutive items sharing a group label into one row', () => {
    const s1e1 = item({ group: 'Season 1' })
    const s1e2 = item({ group: 'Season 1' })
    const s2e1 = item({ group: 'Season 2' })

    expect(groupItems([s1e1, s1e2, s2e1])).toEqual([
      { kind: 'group', label: 'Season 1', items: [s1e1, s1e2] },
      { kind: 'group', label: 'Season 2', items: [s2e1] },
    ])
  })

  it('keeps a manually-added ungrouped item as its own row between groups', () => {
    const s1e1 = item({ group: 'Season 1' })
    const manual = item({ group: null, source: 'manual' })
    const s2e1 = item({ group: 'Season 2' })

    expect(groupItems([s1e1, manual, s2e1])).toEqual([
      { kind: 'group', label: 'Season 1', items: [s1e1] },
      { kind: 'item', item: manual },
      { kind: 'group', label: 'Season 2', items: [s2e1] },
    ])
  })

  it('merges the same label into one row even when it recurs non-consecutively', () => {
    // Real bug, found live: a music list's "group by type" toggle sets
    // `group` from each item's release type, but items stay in chronological
    // order — albums/EPs/singles/live/compilations are naturally interleaved
    // by release date, never contiguous. Folding only consecutive runs (the
    // old behavior this test used to assert) turned a real discography into
    // dozens of one-item "groups" instead of five real sections.
    const first = item({ group: 'Season 1' })
    const between = item({ group: null })
    const second = item({ group: 'Season 1' })

    expect(groupItems([first, between, second])).toEqual([
      { kind: 'group', label: 'Season 1', items: [first, second] },
      { kind: 'item', item: between },
    ])
  })

  it('merges every item sharing a group label, fully interleaved with others', () => {
    const album1 = item({ group: 'Album' })
    const ep1 = item({ group: 'EP' })
    const album2 = item({ group: 'Album' })
    const single1 = item({ group: 'Single' })
    const album3 = item({ group: 'Album' })
    const ep2 = item({ group: 'EP' })

    expect(groupItems([album1, ep1, album2, single1, album3, ep2])).toEqual([
      { kind: 'group', label: 'Album', items: [album1, album2, album3] },
      { kind: 'group', label: 'EP', items: [ep1, ep2] },
      { kind: 'group', label: 'Single', items: [single1] },
    ])
  })

  it('returns nothing for an empty list', () => {
    expect(groupItems([])).toEqual([])
  })
})

describe('moveItem (task 6.7, up/down buttons)', () => {
  it('swaps an item with its neighbor', () => {
    const [a, b, c] = [item(), item(), item()]

    expect(moveItem([a, b, c], b.id, 'up')).toEqual([b, a, c])
    expect(moveItem([a, b, c], b.id, 'down')).toEqual([a, c, b])
  })

  it('refuses to move past either end of the list', () => {
    const [a, b] = [item(), item()]

    expect(moveItem([a, b], a.id, 'up')).toBeNull()
    expect(moveItem([a, b], b.id, 'down')).toBeNull()
  })

  it('refuses to cross a season boundary', () => {
    const s1 = item({ group: 'Season 1' })
    const s2 = item({ group: 'Season 2' })

    expect(moveItem([s1, s2], s2.id, 'up')).toBeNull()
    expect(moveItem([s1, s2], s1.id, 'down')).toBeNull()
  })

  it('moves freely between two ungrouped items, matching a non-TV list', () => {
    const [a, b] = [item({ group: null }), item({ group: null })]

    expect(moveItem([a, b], a.id, 'down')).toEqual([b, a])
  })

  it('returns null for an id that is not in the list', () => {
    const [a, b] = [item(), item()]

    expect(moveItem([a, b], 'nope', 'up')).toBeNull()
  })
})

describe('moveItemTo (task 6.7, drag-and-drop)', () => {
  it("moves the dragged item to take the target's exact slot, shifting the rest", () => {
    const [a, b, c, d] = [item(), item(), item(), item()]

    expect(moveItemTo([a, b, c, d], a.id, c.id)).toEqual([b, a, c, d])
    expect(moveItemTo([a, b, c, d], d.id, b.id)).toEqual([a, d, b, c])
  })

  it('is a no-op dropping an item onto itself', () => {
    const [a, b] = [item(), item()]

    expect(moveItemTo([a, b], a.id, a.id)).toBeNull()
  })

  it('refuses a drop onto a different season', () => {
    const s1 = item({ group: 'Season 1' })
    const s2a = item({ group: 'Season 2' })
    const s2b = item({ group: 'Season 2' })

    expect(moveItemTo([s1, s2a, s2b], s1.id, s2b.id)).toBeNull()
  })

  it("allows a drop anywhere within the dragged item's own season", () => {
    const s1a = item({ group: 'Season 1' })
    const s1b = item({ group: 'Season 1' })
    const s1c = item({ group: 'Season 1' })
    const s2 = item({ group: 'Season 2' })

    expect(moveItemTo([s1a, s1b, s1c, s2], s1a.id, s1c.id)).toEqual([s1b, s1a, s1c, s2])
  })
})
