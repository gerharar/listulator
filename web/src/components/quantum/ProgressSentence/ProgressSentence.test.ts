import { describe, expect, it } from 'vitest'
import { formatProgress } from './ProgressSentence.js'

describe('formatProgress', () => {
  it("matches the design system's own worked example: 16/38 (42%) · 14h 43m left", () => {
    expect(formatProgress(16, 38, 14 * 60 + 43, null)).toEqual({
      count: '16/38 (42%)',
      allDone: false,
      left: '14h 43m left',
    })
  })

  it('reads "✓ All Done" when finished and status is unknown', () => {
    expect(formatProgress(22, 22, 0, null)).toEqual({
      count: '22/22 (100%)',
      allDone: true,
      left: '✓ All Done',
    })
  })

  it('reads "✓ All Done" when finished and the source is marked Complete', () => {
    expect(formatProgress(22, 22, 0, 'complete')).toEqual({
      count: '22/22 (100%)',
      allDone: true,
      left: '✓ All Done',
    })
  })

  it('reads "✓ Done (for now)" when finished but the source is marked Ongoing — it is not a lie about the series', () => {
    expect(formatProgress(301, 301, 0, 'ongoing')).toEqual({
      count: '301/301 (100%)',
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

  it('rounds the percentage to the nearest whole number', () => {
    expect(formatProgress(1, 3, 60, null)).toEqual({
      count: '1/3 (33%)',
      allDone: false,
      left: '1h left',
    })
  })

  describe('while lengths are still being looked up (15.7)', () => {
    it('marks the time left as approximate, since part of it is the category\'s estimate', () => {
      expect(formatProgress(16, 38, 14 * 60 + 43, null, 12)).toEqual({
        count: '16/38 (42%)',
        allDone: false,
        left: '≈ 14h 43m left',
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
