import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { candidatePool, digitsFor, spinDelay, SPIN_MS } from './discover.js'

const entry = (title: string, category: string): LibraryEntry => ({ externalRef: `canonical:${title}`, title, category })
const ENTRIES = [entry('A', 'book'), entry('B', 'mega'), entry('C', 'book'), entry('D', 'mma')]

describe('candidatePool', () => {
  it('is the whole library when no shelf is picked', () => {
    expect(candidatePool(ENTRIES, new Set()).map((e) => e.title)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('narrows to the picked shelves, any of them', () => {
    expect(candidatePool(ENTRIES, new Set(['book'])).map((e) => e.title)).toEqual(['A', 'C'])
    expect(candidatePool(ENTRIES, new Set(['book', 'mma'])).map((e) => e.title)).toEqual(['A', 'C', 'D'])
  })

  it('is empty when nothing is left on the picked shelves', () => {
    expect(candidatePool(ENTRIES, new Set(['tv']))).toEqual([])
  })
})

describe('digitsFor', () => {
  it('reads the count on six dials, padded with zeros', () => {
    expect(digitsFor(23)).toBe('000023')
    expect(digitsFor(757)).toBe('000757')
    expect(digitsFor(0)).toBe('000000')
  })

  it('shows dashes when the index does not say', () => {
    expect(digitsFor(undefined)).toBe('——————')
  })

  it('stops at the dials it has', () => {
    expect(digitsFor(12_345_678)).toBe('999999')
  })
})

describe('the spin', () => {
  it('runs about 1.7 seconds', () => {
    expect(SPIN_MS).toBe(1700)
  })

  it('starts quick and slows to a stop, like a meter settling', () => {
    expect(spinDelay(0)).toBe(55)
    expect(spinDelay(0.5)).toBeGreaterThan(spinDelay(0))
    expect(spinDelay(1)).toBeGreaterThan(spinDelay(0.5))
    expect(spinDelay(1)).toBe(315)
  })
})
