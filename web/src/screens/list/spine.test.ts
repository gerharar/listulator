import { describe, expect, it } from 'vitest'
import type { ListGroup, ListItem } from '../../lib/api.js'
import { buildSpine, listTotals, yearSpanLabel } from './spine.js'

let next = 0

function item(overrides: Partial<ListItem> = {}): ListItem {
  next += 1

  return {
    id: `i${next}`,
    listId: 'L',
    title: `Item ${next}`,
    orderIndex: next,
    timeToConsumeMinutes: 30,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    ...overrides,
  }
}

const group = (name: string, orderIndex: number): ListGroup => ({
  id: `g-${name}`,
  listId: 'L',
  name,
  orderIndex,
})

const shape = (units: ReturnType<typeof buildSpine>) =>
  units.map((unit) =>
    unit.kind === 'item'
      ? unit.item.title
      : `[${unit.group.name}: ${unit.items.map((entry) => entry.title).join(', ')}]`,
  )

describe('buildSpine', () => {
  it('is just the items when nothing is grouped', () => {
    const items = [item({ title: 'a' }), item({ title: 'b' })]

    expect(shape(buildSpine(items, []))).toEqual(['a', 'b'])
  })

  it('gathers a group’s items into one block, where its first item is', () => {
    const items = [
      item({ title: 'a1', group: 'A' }),
      item({ title: 'a2', group: 'A' }),
      item({ title: 'b1', group: 'B' }),
    ]

    expect(shape(buildSpine(items, [group('A', 0), group('B', 1)]))).toEqual([
      '[A: a1, a2]',
      '[B: b1]',
    ])
  })

  it('keeps ungrouped items where they are between blocks', () => {
    const items = [
      item({ title: 'film' }),
      item({ title: 'a1', group: 'A' }),
      item({ title: 'film 2' }),
      item({ title: 'b1', group: 'B' }),
    ]

    expect(shape(buildSpine(items, [group('A', 0), group('B', 1)]))).toEqual([
      'film',
      '[A: a1]',
      'film 2',
      '[B: b1]',
    ])
  })

  it('follows the items’ own order, whatever order they arrive in', () => {
    const late = item({ title: 'late', orderIndex: 9 })
    const early = item({ title: 'early', orderIndex: 1 })

    expect(shape(buildSpine([late, early], []))).toEqual(['early', 'late'])
  })

  it('puts empty groups at the end, in the list’s group order', () => {
    const items = [item({ title: 'a1', group: 'A' })]
    const groups = [group('Empty 1', 0), group('A', 1), group('Empty 2', 2)]

    expect(shape(buildSpine(items, groups))).toEqual(['[A: a1]', '[Empty 1: ]', '[Empty 2: ]'])
  })

  it('gathers a group whose items were split apart', () => {
    const items = [
      item({ title: 'a1', group: 'A' }),
      item({ title: 'x' }),
      item({ title: 'a2', group: 'A' }),
    ]

    expect(shape(buildSpine(items, [group('A', 0)]))).toEqual(['[A: a1, a2]', 'x'])
  })

  it('still shows items whose group label has no group row', () => {
    const items = [item({ title: 'o1', group: 'Orphan' })]

    expect(shape(buildSpine(items, []))).toEqual(['[Orphan: o1]'])
  })

  it('treats a blank label as no group', () => {
    expect(shape(buildSpine([item({ title: 'a', group: '' })], []))).toEqual(['a'])
  })

  describe('a group’s own progress', () => {
    const blockOf = (items: ListItem[]) => {
      const [block] = buildSpine(items, [group('A', 0)])
      if (block?.kind !== 'group') throw new Error('expected a group')
      return block
    }

    it('counts done items and adds up the time left on the rest', () => {
      const block = blockOf([
        item({ group: 'A', timeToConsumeMinutes: 20, consumedAt: '2026-01-01' }),
        item({ group: 'A', timeToConsumeMinutes: 30 }),
        item({ group: 'A', timeToConsumeMinutes: 45 }),
      ])

      expect(block).toMatchObject({ done: 1, total: 3, minutesLeft: 75, allDone: false })
    })

    it('is all done only when it has items and every one is done', () => {
      expect(blockOf([item({ group: 'A', consumedAt: '2026-01-01' })]).allDone).toBe(true)
      expect(blockOf([]).allDone).toBe(false)
    })

    it('spans the years of its items', () => {
      const block = blockOf([
        item({ group: 'A', year: 2021 }),
        item({ group: 'A', year: 2019 }),
        item({ group: 'A' }),
      ])

      expect(block.yearSpan).toEqual({ from: 2019, to: 2021 })
    })

    it('has no span when no item has a year', () => {
      expect(blockOf([item({ group: 'A' })]).yearSpan).toBeNull()
    })
  })
})

describe('yearSpanLabel', () => {
  it('reads "(2019–2021)", or a single year, or nothing', () => {
    expect(yearSpanLabel({ from: 2019, to: 2021 })).toBe('(2019–2021)')
    expect(yearSpanLabel({ from: 2019, to: 2019 })).toBe('(2019)')
    expect(yearSpanLabel(null)).toBeNull()
  })
})

describe('listTotals', () => {
  it('counts what is done and the time left on the rest', () => {
    expect(
      listTotals([
        item({ timeToConsumeMinutes: 10, consumedAt: '2026-01-01' }),
        item({ timeToConsumeMinutes: 20 }),
        item({ timeToConsumeMinutes: 30 }),
      ]),
    ).toEqual({ done: 1, total: 3, minutesLeft: 50 })
  })

  it('is all zeros for an empty list', () => {
    expect(listTotals([])).toEqual({ done: 0, total: 0, minutesLeft: 0 })
  })
})
