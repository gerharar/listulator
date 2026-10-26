import { describe, expect, it } from 'vitest'
import { putBack } from './rollback.js'

const rows = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (list: readonly { id: string }[]) => list.map((row) => row.id)

describe('putBack', () => {
  it('puts a removed row back after the row that preceded it', () => {
    const before = rows('a', 'b', 'c')

    expect(ids(putBack(rows('a', 'c'), before, [before[1]!]))).toEqual(['a', 'b', 'c'])
  })

  it('puts a removed first row back at the start', () => {
    const before = rows('a', 'b')

    expect(ids(putBack(rows('b'), before, [before[0]!]))).toEqual(['a', 'b'])
  })

  it('keeps what changed meanwhile: a row removed since stays removed, a row added since stays', () => {
    const before = rows('a', 'b', 'c', 'd')
    const current = rows('a', 'c', 'x') // b was the one refused; d was removed and x added since the click

    expect(ids(putBack(current, before, [before[1]!]))).toEqual(['a', 'b', 'c', 'x'])
  })

  it('anchors on the nearest row that is still there when the preceding one is gone', () => {
    const before = rows('a', 'b', 'c')

    expect(ids(putBack(rows('a'), before, [before[2]!]))).toEqual(['a', 'c'])
  })

  it('puts several removed rows back in their old order, each after the one before it', () => {
    const before = rows('a', 'b', 'c', 'd')

    expect(ids(putBack(rows('a', 'd'), before, [before[1]!, before[2]!]))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not duplicate a row that is already back (a refresh brought it)', () => {
    const before = rows('a', 'b')

    expect(ids(putBack(rows('a', 'b'), before, [before[1]!]))).toEqual(['a', 'b'])
  })

  it('returns the current rows unchanged when nothing was removed', () => {
    const current = rows('a')

    expect(putBack(current, rows('a'), [])).toEqual(current)
  })
})

/** The first version of `putBack` (BL-109), kept as the oracle: the rewrite must give the same rows in the same order in every case. */
function putBackNaive<T extends { id: string }>(current: readonly T[], before: readonly T[], removed: readonly T[]): T[] {
  const result = [...current]

  for (const row of before.filter((entry) => removed.some((gone) => gone.id === entry.id))) {
    if (result.some((entry) => entry.id === row.id)) continue
    let at = 0

    for (let index = before.findIndex((entry) => entry.id === row.id) - 1; index >= 0; index -= 1) {
      const anchor = result.findIndex((entry) => entry.id === before[index]!.id)

      if (anchor !== -1) {
        at = anchor + 1
        break
      }
    }

    result.splice(at, 0, row)
  }

  return result
}

describe('putBack gives the rows the first version gave, in every case (BL-123)', () => {
  // A small deterministic generator, so a failure can be repeated.
  const generator = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296

    return seed / 4294967296
  }

  it('agrees with the first version on 2,000 random lists: rows removed, rows gone since, rows added since, rows already back', () => {
    const random = generator(7)

    for (let round = 0; round < 2000; round += 1) {
      const size = 1 + Math.floor(random() * 12)
      const before = rows(...Array.from({ length: size }, (_, index) => `r${index}`))
      const removed = before.filter(() => random() < 0.4)
      // What is here now: the rows not removed, some gone since, some of the removed already back, and a few new ones in odd places.
      const current = before.filter((row) => (removed.includes(row) ? random() < 0.2 : random() < 0.85))
      for (let extra = 0; extra < Math.floor(random() * 3); extra += 1) current.splice(Math.floor(random() * (current.length + 1)), 0, { id: `new${round}-${extra}` })

      expect(ids(putBack(current, before, removed)), `round ${round}`).toEqual(ids(putBackNaive(current, before, removed)))
    }
  })

  it('leaves out a removed row that was never in the list at the click, as before', () => {
    const before = rows('a', 'b')

    expect(ids(putBack(rows('a'), before, [{ id: 'zzz' }, before[1]!]))).toEqual(ids(putBackNaive(rows('a'), before, [{ id: 'zzz' }, before[1]!])))
  })
})

describe('putBack on a large list (BL-123)', () => {
  const LIST = 50_000
  const before = rows(...Array.from({ length: LIST }, (_, index) => `r${index}`))

  it('puts back 5,000 rows of a group in a list of 50,000 in well under a second', () => {
    const removed = before.slice(20_000, 25_000)
    const current = [...before.slice(0, 20_000), ...before.slice(25_000)]
    const started = performance.now()

    const result = putBack(current, before, removed)

    expect(performance.now() - started).toBeLessThan(500)
    expect(ids(result)).toEqual(ids(before))
  })

  it('does the same for 5,000 rows scattered through the list', () => {
    const removed = before.filter((_, index) => index % 10 === 3)
    const gone = new Set(removed)
    const current = before.filter((row) => !gone.has(row))
    const started = performance.now()

    const result = putBack(current, before, removed)

    expect(performance.now() - started).toBeLessThan(500)
    expect(ids(result)).toEqual(ids(before))
  })
})
