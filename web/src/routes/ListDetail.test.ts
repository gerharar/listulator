import { describe, expect, it } from 'vitest'
import { groupItems } from './ListDetail.js'
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

  it('starts a new group row when the same label recurs non-consecutively', () => {
    const first = item({ group: 'Season 1' })
    const between = item({ group: null })
    const second = item({ group: 'Season 1' })

    expect(groupItems([first, between, second])).toEqual([
      { kind: 'group', label: 'Season 1', items: [first] },
      { kind: 'item', item: between },
      { kind: 'group', label: 'Season 1', items: [second] },
    ])
  })

  it('returns nothing for an empty list', () => {
    expect(groupItems([])).toEqual([])
  })
})
