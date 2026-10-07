import { describe, expect, it } from 'vitest'
import type { ListWithStats } from '../catalog/repository.js'
import type { ListItem } from '../db/schema.js'
import { rank } from './engine.js'
import { parseStrategy, StrategyError, type Strategy } from './strategy.js'
import justOneFixJson from '../../../config/strategies/just-one-fix.json'

/** Just One Fix (10.28): the unit ranked is a single unconsumed item, not a list. */

const NOW = new Date('2026-06-01T12:00:00Z')

function list(id: string, over: Partial<ListWithStats> = {}): ListWithStats {
  return {
    id,
    userId: 'user',
    title: id,
    description: null,
    mediaType: 'movie',
    source: 'manual',
    externalRef: null,
    status: null,
    arrivedTitle: null,
    arrivedDescription: null,
    arrivedStatus: null,
    snapshotFetchedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    stats: { totalItems: 3, consumedItems: 0, newItems: 0, completionPercent: 0, timeRemainingMinutes: 0, lastConsumedAt: null },
    ...over,
  }
}

function item(listId: string, index: number, minutes: number): ListItem {
  return {
    id: `${listId}-${index}`,
    listId,
    title: `${listId} #${index}`,
    orderIndex: index,
    timeToConsumeMinutes: minutes,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    externalRef: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    isNew: false,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const justOneFix = parseStrategy(justOneFixJson, 'just-one-fix.json')

/** Each list with the minutes of its *unconsumed* items, in order. */
function run(spec: Record<string, number[]>, strategy: Strategy = justOneFix) {
  const candidates = Object.keys(spec).map((id) => list(id))
  const unconsumed = new Map(Object.entries(spec).map(([id, minutes]) => [id, minutes.map((m, i) => item(id, i, m))]))
  const nextItems = new Map([...unconsumed].map(([id, items]) => [id, items[0]]))

  return rank({ strategy, candidates, nextItems, unconsumed, now: NOW })
}

describe('item-level ranking (unit: item)', () => {
  it('picks the shortest unconsumed item across every list', () => {
    const result = run({ a: [45, 30], b: [12, 90], c: [20] })

    expect(result[0]!.nextItem!.title).toBe('b #0')
    expect(result[0]!.nextItem!.timeToConsumeMinutes).toBe(12)
    expect(result[0]!.list.id).toBe('b')
  })

  it('finds the shortest item wherever it sits in its list, not only the next one', () => {
    // a's next item is long, but a later one is the shortest of all.
    expect(run({ a: [90, 5], b: [20] })[0]!.nextItem!.title).toBe('a #1')
  })

  it('ignores consumed items even if a caller hands them over', () => {
    // The desktop app builds its own input; the engine must not trust it to have filtered.
    const a = [item('a', 0, 1), item('a', 1, 45)]
    a[0]!.consumedAt = new Date('2026-05-01T00:00:00Z')
    const b = [item('b', 0, 30)]

    const result = rank({
      strategy: justOneFix,
      candidates: [list('a'), list('b')],
      nextItems: new Map(),
      unconsumed: new Map([['a', a], ['b', b]]),
      now: NOW,
    })

    expect(result.map((entry) => entry.nextItem!.timeToConsumeMinutes)).toEqual([30, 45])
    expect(result.some((entry) => entry.nextItem!.timeToConsumeMinutes === 1)).toBe(false)
  })

  it('offers each list once, by its own shortest item, best first', () => {
    const result = run({ a: [10, 11, 12], b: [30, 31], c: [20] })

    expect(result.map((entry) => entry.list.id)).toEqual(['a', 'c', 'b'])
    expect(result.map((entry) => entry.nextItem!.timeToConsumeMinutes)).toEqual([10, 20, 30])
  })

  it('leaves out a list with nothing unconsumed', () => {
    expect(run({ a: [], b: [30] }).map((entry) => entry.list.id)).toEqual(['b'])
  })

  it('has nothing to offer when nothing is left anywhere', () => {
    expect(run({ a: [], b: [] })).toEqual([])
  })

  it('breaks a tie the same way every time: by list, then by position', () => {
    expect(run({ b: [15, 15], a: [15] }).map((entry) => `${entry.list.id}:${entry.nextItem!.title}`)).toEqual([
      'a:a #0',
      'b:b #0',
    ])
  })

  it('reports the item factor’s contribution, best 1 and worst 0, so the why can be built from it', () => {
    const result = run({ a: [10], b: [50] })

    expect(result[0]!.factors['item_minutes']).toBe(1)
    expect(result[1]!.factors['item_minutes']).toBe(0)
  })

  it('demands the items it ranks, rather than guessing from the next ones', () => {
    expect(() =>
      rank({ strategy: justOneFix, candidates: [list('a')], nextItems: new Map(), now: NOW }),
    ).toThrow(/unconsumed/)
  })
})

describe('list strategies are unaffected', () => {
  it('a strategy without a unit still ranks lists', () => {
    const strategy = parseStrategy(
      { name: 'x', scope: 'all_lists', factors: [{ type: 'completion_percent', direction: 'favor_highest', weight: 1 }] },
      'x.json',
    )

    expect(strategy.unit).toBe('list')
  })
})

describe('parseStrategy and the unit', () => {
  const base = { name: 'x', scope: 'all_lists' }

  it('accepts an item strategy with an item factor', () => {
    const strategy = parseStrategy({ ...base, unit: 'item', factors: [{ type: 'item_minutes', direction: 'favor_lowest', weight: 1 }] }, 'x.json')

    expect(strategy.unit).toBe('item')
  })

  it('refuses a list factor in an item strategy, and an item factor in a list strategy, naming the file', () => {
    const item = { ...base, unit: 'item', factors: [{ type: 'completion_percent', direction: 'favor_highest', weight: 1 }] }
    const listy = { ...base, factors: [{ type: 'item_minutes', direction: 'favor_lowest', weight: 1 }] }

    expect(() => parseStrategy(item, 'a.json')).toThrow(StrategyError)
    expect(() => parseStrategy(item, 'a.json')).toThrow(/a\.json.*item/)
    expect(() => parseStrategy(listy, 'b.json')).toThrow(/b\.json/)
  })

  it('refuses a unit that is neither', () => {
    expect(() =>
      parseStrategy({ ...base, unit: 'series', factors: [{ type: 'item_minutes', direction: 'favor_lowest', weight: 1 }] }, 'x.json'),
    ).toThrow(/"unit" must be one of/)
  })
})
