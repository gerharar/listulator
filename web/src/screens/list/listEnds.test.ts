import { describe, expect, it } from 'vitest'
import { endForKey, endRow, endScrollTop } from './listEnds.js'

/** The two ends of a list (H-019): the keys that go there, the row that is there, and where the scroller must be. */

describe('endForKey', () => {
  it('maps Home to the top and End to the bottom, and nothing else', () => {
    expect(endForKey('Home')).toBe('top')
    expect(endForKey('End')).toBe('bottom')
    expect(endForKey('ArrowDown')).toBeNull()
    expect(endForKey('PageDown')).toBeNull()
    expect(endForKey('h')).toBeNull()
  })
})

describe('endRow', () => {
  it('is the first row at the top and the last at the bottom', () => {
    const rows = ['g1', 'a', 'b', 'c']

    expect(endRow(rows, 'top')).toBe('g1')
    expect(endRow(rows, 'bottom')).toBe('c')
  })

  it('is the same row for a list of one', () => {
    expect(endRow(['only'], 'top')).toBe('only')
    expect(endRow(['only'], 'bottom')).toBe('only')
  })

  it('is nothing for a list with no rows', () => {
    expect(endRow([], 'top')).toBeUndefined()
    expect(endRow([], 'bottom')).toBeUndefined()
  })
})

describe('endScrollTop', () => {
  it('is 0 at the top, and the whole height at the bottom (the browser clamps it to the last screenful)', () => {
    expect(endScrollTop('top', 230_000)).toBe(0)
    expect(endScrollTop('bottom', 230_000)).toBe(230_000)
  })
})
