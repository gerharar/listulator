import { describe, expect, it } from 'vitest'
import type { ListGroup, ListItem } from '../../lib/api.js'
import {
  applyPositions,
  dropItemInGroup,
  dropUnit,
  stepItemInGroup,
  stepUnit,
  type MoveOutcome,
} from './moves.js'

let n = 0
function item(id: string, over: Partial<ListItem> = {}): ListItem {
  n += 1
  return {
    id,
    listId: 'L',
    title: `T-${id}`,
    orderIndex: n,
    timeToConsumeMinutes: 10,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    isNew: false,
    ...over,
  }
}
const group = (id: string, name: string, orderIndex: number): ListGroup => ({ id, listId: 'L', name, orderIndex })

/** Loose a, then group G (g1 g2 g3), then loose b, then group H (h1 h2), then loose c. Indexes 0..8. */
function fixture() {
  const items = [
    item('a', { orderIndex: 0 }),
    item('g1', { orderIndex: 1, group: 'G' }),
    item('g2', { orderIndex: 2, group: 'G' }),
    item('g3', { orderIndex: 3, group: 'G' }),
    item('b', { orderIndex: 4 }),
    item('h1', { orderIndex: 5, group: 'H' }),
    item('h2', { orderIndex: 6, group: 'H' }),
    item('c', { orderIndex: 7 }),
  ]
  const groups = [group('gG', 'G', 0), group('gH', 'H', 1)]
  return { items, groups }
}

/** The list as it would read after the move: ids in order, and the group rows in order. */
function after(outcome: MoveOutcome, items: ListItem[], groups: ListGroup[]) {
  if (outcome.kind !== 'moved') throw new Error(`not moved: ${outcome.kind}`)
  const applied = applyPositions(items, groups, outcome.next)

  return {
    ids: [...applied.items].sort((x, y) => x.orderIndex - y.orderIndex).map((i) => i.id),
    groups: [...applied.groups].sort((x, y) => x.orderIndex - y.orderIndex).map((g) => g.id),
  }
}

describe('dropUnit (a group, or a loose item, moves as one block)', () => {
  it('moves a group past loose items and other groups, taking all its items along in order', () => {
    const { items, groups } = fixture()

    const result = after(dropUnit(items, groups, 'gG', 'c', 'after'), items, groups)

    expect(result.ids).toEqual(['a', 'b', 'h1', 'h2', 'c', 'g1', 'g2', 'g3'])
    expect(result.groups).toEqual(['gH', 'gG'])
  })

  it('drops before or after the target by where it is dropped', () => {
    const { items, groups } = fixture()

    expect(after(dropUnit(items, groups, 'b', 'a', 'before'), items, groups).ids).toEqual(['b', 'a', 'g1', 'g2', 'g3', 'h1', 'h2', 'c'])
    expect(after(dropUnit(items, groups, 'b', 'a', 'after'), items, groups).ids).toEqual(['a', 'b', 'g1', 'g2', 'g3', 'h1', 'h2', 'c'])
  })

  it('moves a loose item across a whole group block', () => {
    const { items, groups } = fixture()

    const result = after(dropUnit(items, groups, 'a', 'gG', 'after'), items, groups)

    expect(result.ids).toEqual(['g1', 'g2', 'g3', 'a', 'b', 'h1', 'h2', 'c'])
    expect(result.groups).toEqual(['gG', 'gH'])
  })

  it('keeps the group rows in the order the blocks now stand in', () => {
    const { items, groups } = fixture()

    const result = after(dropUnit(items, groups, 'gH', 'gG', 'before'), items, groups)

    expect(result.groups).toEqual(['gH', 'gG'])
  })

  it('leaves empty groups after the rest, in their own order', () => {
    const { items } = fixture()
    const groups = [group('gG', 'G', 0), group('gH', 'H', 1), group('gE', 'Empty', 2)]

    const result = after(dropUnit(items, groups, 'gH', 'gG', 'before'), items, groups)

    expect(result.groups).toEqual(['gH', 'gG', 'gE'])
  })

  it('is nothing when dropped on itself, or somewhere it already is', () => {
    const { items, groups } = fixture()

    expect(dropUnit(items, groups, 'gG', 'gG', 'after').kind).toBe('none')
    expect(dropUnit(items, groups, 'a', 'gG', 'before').kind).toBe('none')
    expect(dropUnit(items, groups, 'gG', 'a', 'after').kind).toBe('none')
  })

  it('is nothing for a target that is not there', () => {
    const { items, groups } = fixture()

    expect(dropUnit(items, groups, 'a', 'nope', 'after').kind).toBe('none')
    expect(dropUnit(items, groups, 'nope', 'a', 'after').kind).toBe('none')
  })

  it('says where it went: which block, out of how many, and what to pulse', () => {
    const { items, groups } = fixture()

    const outcome = dropUnit(items, groups, 'gG', 'c', 'after')

    expect(outcome).toMatchObject({ kind: 'moved', title: 'G', position: 5, total: 5 })
    expect((outcome as Extract<MoveOutcome, { kind: 'moved' }>).pulseIds.sort()).toEqual(['g1', 'g2', 'g3', 'gG'].sort())
  })

  it('a list with no groups is just loose items moving among themselves', () => {
    const items = [item('x', { orderIndex: 0 }), item('y', { orderIndex: 1 }), item('z', { orderIndex: 2 })]

    expect(after(dropUnit(items, [], 'x', 'z', 'after'), items, []).ids).toEqual(['y', 'z', 'x'])
  })

  it('sends only what changed, and what to put back to undo it', () => {
    const { items, groups } = fixture()

    const outcome = dropUnit(items, groups, 'b', 'a', 'before') as Extract<MoveOutcome, { kind: 'moved' }>

    expect(outcome.next.items.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'g1', 'g2', 'g3'].sort())
    for (const entry of outcome.previous.items) {
      expect(entry.orderIndex).toBe(items.find((i) => i.id === entry.id)!.orderIndex)
    }
    expect(outcome.previous.items.map((e) => e.id).sort()).toEqual(outcome.next.items.map((e) => e.id).sort())
  })

  it('undoes exactly: applying what to put back restores every position', () => {
    const { items, groups } = fixture()
    const outcome = dropUnit(items, groups, 'gG', 'c', 'after') as Extract<MoveOutcome, { kind: 'moved' }>

    const moved = applyPositions(items, groups, outcome.next)
    const back = applyPositions(moved.items, moved.groups, outcome.previous)

    expect(back.items.map((i) => [i.id, i.orderIndex])).toEqual(items.map((i) => [i.id, i.orderIndex]))
    expect(back.groups.map((g) => [g.id, g.orderIndex])).toEqual(groups.map((g) => [g.id, g.orderIndex]))
  })
})

describe('loose items and label-only groups', () => {
  it('a loose item dropped on another loose item moves as a block, across any group between them', () => {
    const { items, groups } = fixture()

    const result = after(dropItemInGroup(items, groups, 'a', 'b', 'after'), items, groups)

    expect(result.ids).toEqual(['g1', 'g2', 'g3', 'b', 'a', 'h1', 'h2', 'c'])
  })

  it('a group with items but no row of its own takes no slot among the group rows', () => {
    const items = [
      item('x1', { orderIndex: 0, group: 'Orphan' }),
      item('g1', { orderIndex: 1, group: 'G' }),
      item('h1', { orderIndex: 2, group: 'H' }),
    ]
    const groups = [group('gG', 'G', 5), group('gH', 'H', 6)]

    const outcome = dropUnit(items, groups, 'gH', 'gG', 'before') as Extract<MoveOutcome, { kind: 'moved' }>

    expect(outcome.next.groups).toEqual([
      { id: 'gG', orderIndex: 1 },
      { id: 'gH', orderIndex: 0 },
    ])
  })
})

describe('stepUnit (Shift+↑↓ on a group or a loose item)', () => {
  it('moves one block down, and up', () => {
    const { items, groups } = fixture()

    expect(after(stepUnit(items, groups, 'a', 1), items, groups).ids).toEqual(['g1', 'g2', 'g3', 'a', 'b', 'h1', 'h2', 'c'])
    expect(after(stepUnit(items, groups, 'gH', -1), items, groups).ids).toEqual(['a', 'g1', 'g2', 'g3', 'h1', 'h2', 'b', 'c'])
  })

  it('names the new position among the blocks: "moved to 2 of 5"', () => {
    const { items, groups } = fixture()

    expect(stepUnit(items, groups, 'a', 1)).toMatchObject({ kind: 'moved', title: 'T-a', position: 2, total: 5 })
    expect(stepUnit(items, groups, 'gG', -1)).toMatchObject({ kind: 'moved', title: 'G', position: 1, total: 5 })
  })

  it('says it is at the edge, and changes nothing', () => {
    const { items, groups } = fixture()

    expect(stepUnit(items, groups, 'a', -1)).toEqual({ kind: 'edge', side: 'top' })
    expect(stepUnit(items, groups, 'c', 1)).toEqual({ kind: 'edge', side: 'bottom' })
  })

  it('does not move an empty group past the end, where it always sits', () => {
    const { items } = fixture()
    const groups = [group('gG', 'G', 0), group('gH', 'H', 1), group('gE', 'Empty', 2)]

    expect(stepUnit(items, groups, 'c', 1)).toEqual({ kind: 'edge', side: 'bottom' })
  })
})

describe('dropItemInGroup (an item moves only inside its own group)', () => {
  it('moves it within the group, and nothing else in the list moves', () => {
    const { items, groups } = fixture()

    const outcome = dropItemInGroup(items, groups, 'g1', 'g3', 'after')
    const result = after(outcome, items, groups)

    expect(result.ids).toEqual(['a', 'g2', 'g3', 'g1', 'b', 'h1', 'h2', 'c'])
    expect((outcome as Extract<MoveOutcome, { kind: 'moved' }>).next.items.map((e) => e.id).sort()).toEqual(['g1', 'g2', 'g3'])
    expect((outcome as Extract<MoveOutcome, { kind: 'moved' }>).next.groups).toEqual([])
  })

  it('reuses the group’s own slots, even when they are not next to each other', () => {
    const items = [
      item('g1', { orderIndex: 0, group: 'G' }),
      item('x', { orderIndex: 1 }),
      item('g2', { orderIndex: 2, group: 'G' }),
    ]
    const groups = [group('gG', 'G', 0)]

    const result = after(dropItemInGroup(items, groups, 'g1', 'g2', 'after'), items, groups)

    expect(result.ids).toEqual(['g2', 'x', 'g1'])
  })

  it('is refused across groups, or between a group’s item and a loose one', () => {
    const { items, groups } = fixture()

    expect(dropItemInGroup(items, groups, 'g1', 'h1', 'after')).toEqual({ kind: 'refused' })
    expect(dropItemInGroup(items, groups, 'g1', 'a', 'before')).toEqual({ kind: 'refused' })
  })

  it('is nothing when dropped where it already is', () => {
    const { items, groups } = fixture()

    expect(dropItemInGroup(items, groups, 'g1', 'g1', 'after').kind).toBe('none')
    expect(dropItemInGroup(items, groups, 'g2', 'g1', 'after').kind).toBe('none')
    expect(dropItemInGroup(items, groups, 'g1', 'g2', 'before').kind).toBe('none')
  })

  it('says where it went among the group’s own items', () => {
    const { items, groups } = fixture()

    expect(dropItemInGroup(items, groups, 'g1', 'g3', 'after')).toMatchObject({
      kind: 'moved',
      title: 'T-g1',
      position: 3,
      total: 3,
      groupName: 'G',
      pulseIds: ['g1'],
    })
  })
})

describe('stepItemInGroup (Shift+↑↓ on a grouped item)', () => {
  it('swaps with its neighbour inside the group', () => {
    const { items, groups } = fixture()

    expect(after(stepItemInGroup(items, groups, 'g2', 1), items, groups).ids).toEqual(['a', 'g1', 'g3', 'g2', 'b', 'h1', 'h2', 'c'])
    expect(after(stepItemInGroup(items, groups, 'g2', -1), items, groups).ids).toEqual(['a', 'g2', 'g1', 'g3', 'b', 'h1', 'h2', 'c'])
  })

  it('stops at the group’s own ends, and says which', () => {
    const { items, groups } = fixture()

    expect(stepItemInGroup(items, groups, 'g1', -1)).toEqual({ kind: 'edge', side: 'top', groupName: 'G' })
    expect(stepItemInGroup(items, groups, 'g3', 1)).toEqual({ kind: 'edge', side: 'bottom', groupName: 'G' })
  })

  it('a loose item steps as a block instead, past groups', () => {
    const { items, groups } = fixture()

    expect(after(stepItemInGroup(items, groups, 'a', 1), items, groups).ids).toEqual(['g1', 'g2', 'g3', 'a', 'b', 'h1', 'h2', 'c'])
  })

  it('says the new position: "moved to 3 of 3 in G"', () => {
    const { items, groups } = fixture()

    expect(stepItemInGroup(items, groups, 'g2', 1)).toMatchObject({ kind: 'moved', position: 3, total: 3, groupName: 'G' })
  })
})

describe('the drag and keyboard paths save the same order', () => {
  it('one step down equals dropping after the next item', () => {
    const { items, groups } = fixture()

    const step = stepItemInGroup(items, groups, 'g1', 1) as Extract<MoveOutcome, { kind: 'moved' }>
    const drop = dropItemInGroup(items, groups, 'g1', 'g2', 'after') as Extract<MoveOutcome, { kind: 'moved' }>

    expect(step.next).toEqual(drop.next)
    expect(step.previous).toEqual(drop.previous)
  })

  it('one block step up equals dropping before the previous block', () => {
    const { items, groups } = fixture()

    const step = stepUnit(items, groups, 'gH', -1) as Extract<MoveOutcome, { kind: 'moved' }>
    const drop = dropUnit(items, groups, 'gH', 'b', 'before') as Extract<MoveOutcome, { kind: 'moved' }>

    expect(step.next).toEqual(drop.next)
  })
})
