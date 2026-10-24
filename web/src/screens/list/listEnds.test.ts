import { describe, expect, it } from 'vitest'
import { atEnds, endForKey, endRow, endScrollTop, showEnds } from './listEnds.js'

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

describe('showEnds', () => {
  it('is for a list taller than two screens of its scroll area, and not for one of exactly two', () => {
    expect(showEnds(920, 460)).toBe(false)
    expect(showEnds(921, 460)).toBe(true)
    expect(showEnds(200, 460)).toBe(false)
    expect(showEnds(230_000, 460)).toBe(true)
  })

  it('is never for a scroll area with no height yet', () => {
    expect(showEnds(5_000, 0)).toBe(false)
  })
})

describe('atEnds', () => {
  it('is at the top at 0 and at the bottom when the last screenful is showing', () => {
    expect(atEnds(0, 460, 2000)).toEqual({ atTop: true, atBottom: false })
    expect(atEnds(500, 460, 2000)).toEqual({ atTop: false, atBottom: false })
    expect(atEnds(1540, 460, 2000)).toEqual({ atTop: false, atBottom: true })
  })

  it('forgives a pixel: the browser rounds a scroll position', () => {
    expect(atEnds(0.6, 460, 2000).atTop).toBe(true)
    expect(atEnds(1539.4, 460, 2000).atBottom).toBe(true)
    expect(atEnds(2, 460, 2000).atTop).toBe(false)
  })

  it('is at both ends when everything fits', () => {
    expect(atEnds(0, 460, 300)).toEqual({ atTop: true, atBottom: true })
  })
})

