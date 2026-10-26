import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { shelfPicks } from './shelfPicks.js'

function entry(category: string, n: number): LibraryEntry {
  return { externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} ${n}`, category, itemCount: 10 * n }
}

const CATEGORIES = ['movie', 'tv', 'game', 'book', 'music', 'comic', 'wrestling', 'mma']
const MANY = CATEGORIES.flatMap((category) => [1, 2, 3].map((n) => entry(category, n)))

/** A fixed random source: the same numbers in the same order. */
function sequence(...numbers: number[]): () => number {
  let at = 0

  return () => numbers[at++ % numbers.length]!
}

describe('shelfPicks: three random library lists, each from a different category (H-018, revised 2026-10-26; was six)', () => {
  it('picks three lists from three distinct categories out of many', () => {
    const picks = shelfPicks(MANY, Math.random)

    expect(picks).toHaveLength(3)
    expect(new Set(picks.map((pick) => pick.category)).size).toBe(3)
    for (const pick of picks) expect(MANY).toContain(pick)
  })

  it('picks fewer when the library has fewer categories, one list for each', () => {
    const picks = shelfPicks(MANY.filter((e) => ['movie', 'tv'].includes(e.category)), Math.random)

    expect(picks).toHaveLength(2)
    expect(new Set(picks.map((pick) => pick.category))).toEqual(new Set(['movie', 'tv']))
  })

  it('takes the one list of a category that has only one', () => {
    const only = entry('mma', 1)
    const picks = shelfPicks([only, ...MANY.filter((e) => e.category === 'movie')], Math.random)

    expect(picks).toContain(only)
  })

  it('has nothing to pick from an empty library', () => {
    expect(shelfPicks([], Math.random)).toEqual([])
  })

  it('follows the random source, so a fixed one gives the same shelf every time and another gives another', () => {
    const first = shelfPicks(MANY, sequence(0.05, 0.4, 0.9))
    const again = shelfPicks(MANY, sequence(0.05, 0.4, 0.9))
    const other = shelfPicks(MANY, sequence(0.95, 0.15, 0.55))

    expect(again).toEqual(first)
    expect(other).not.toEqual(first)
  })

  it('does not change the list it is given', () => {
    const copy = [...MANY]

    shelfPicks(MANY, Math.random)

    expect(MANY).toEqual(copy)
  })

  it('can reach every list of a category, not only the first', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 200; n += 1) for (const pick of shelfPicks(MANY, Math.random)) seen.add(pick.externalRef)

    expect(seen.size).toBe(MANY.length)
  })
})
