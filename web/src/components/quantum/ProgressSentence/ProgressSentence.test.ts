import { describe, expect, it } from 'vitest'
import { formatProgress, groupColumnChars } from './ProgressSentence.js'

describe('formatProgress', () => {
  it("matches the design system's own worked example, the count alone (H-024: the % sits beside the bar): 16/38 · 14h 43m left", () => {
    expect(formatProgress(16, 38, 14 * 60 + 43, null)).toEqual({
      count: '16/38',
      allDone: false,
      left: '14h 43m left',
    })
  })

  it('reads "✓ All Done" when finished and status is unknown', () => {
    expect(formatProgress(22, 22, 0, null)).toEqual({
      count: '22/22',
      allDone: true,
      left: '✓ All Done',
    })
  })

  it('reads "✓ All Done" when finished and the source is marked Complete', () => {
    expect(formatProgress(22, 22, 0, 'complete')).toEqual({
      count: '22/22',
      allDone: true,
      left: '✓ All Done',
    })
  })

  it('reads "✓ Done (for now)" when finished but the source is marked Ongoing — it is not a lie about the series', () => {
    expect(formatProgress(301, 301, 0, 'ongoing')).toEqual({
      count: '301/301',
      allDone: true,
      left: '✓ Done (for now)',
    })
  })

  it('has no time field on an empty list', () => {
    expect(formatProgress(0, 0, 0, null)).toEqual({
      count: '0/0',
      allDone: false,
      left: null,
    })
  })

  it('keeps the percentage out of the count (H-024)', () => {
    expect(formatProgress(1, 3, 60, null)).toEqual({
      count: '1/3',
      allDone: false,
      left: '1h left',
    })
  })

  describe('while lengths are still being looked up (15.7)', () => {
    it('marks the time left as approximate, since part of it is the category\'s estimate', () => {
      expect(formatProgress(16, 38, 14 * 60 + 43, null, 12)).toEqual({
        count: '16/38',
        allDone: false,
        left: '≈14h 43m left',
      })
    })

    it('says nothing different when nothing is pending', () => {
      expect(formatProgress(16, 38, 14 * 60 + 43, null, 0).left).toBe('14h 43m left')
      expect(formatProgress(16, 38, 14 * 60 + 43, null).left).toBe('14h 43m left')
    })

    it('does not touch a finished list: nothing is left to be approximate about', () => {
      expect(formatProgress(22, 22, 0, null, 3).left).toBe('✓ All Done')
    })

    it('does not give an empty list a time', () => {
      expect(formatProgress(0, 0, 0, null, 3).left).toBeNull()
    })
  })
})

describe('groupColumnChars (BL-160: the group heads\' bars start in one column)', () => {
  it('is nothing for a list without groups', () => {
    expect(groupColumnChars([])).toEqual({ count: 0, left: 0 })
  })

  it('sizes the count by the widest group at its longest, "38/38": marking items never changes it', () => {
    expect(groupColumnChars([{ total: 38, totalMinutes: 60 }]).count).toBe(5)
    expect(groupColumnChars([{ total: 38, totalMinutes: 60 }, { total: 120, totalMinutes: 60 }]).count).toBe(7)
  })

  it('sizes the time by the longest it can read while items are ticked off: 14h 43m can pass through 13h 59m, both 12 characters', () => {
    expect(groupColumnChars([{ total: 38, totalMinutes: 14 * 60 + 43 }]).left).toBe('13h 59m left'.length)
  })

  it('counts a tidy 10h as the 9h 59m it passes through on the way down', () => {
    expect(groupColumnChars([{ total: 4, totalMinutes: 600 }]).left).toBe('9h 59m left'.length)
  })

  it('keeps room for the finished state, which is drawn smaller but spaced wider than the time', () => {
    const { left } = groupColumnChars([{ total: 2, totalMinutes: 20 }])

    expect(left).toBeGreaterThanOrEqual(Math.ceil(('✓ All Done'.length * 11) / 10))
  })

  it('gives a group with no items a count but no time, and the widest group still decides', () => {
    expect(groupColumnChars([{ total: 0, totalMinutes: 0 }])).toEqual({ count: 3, left: 0 })
    expect(groupColumnChars([{ total: 0, totalMinutes: 0 }, { total: 9, totalMinutes: 5 }]).count).toBe(3)
  })
})
