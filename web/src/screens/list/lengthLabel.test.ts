import { describe, expect, it } from 'vitest'
import { lengthLabel, minutesColumnWidth } from './lengthLabel.js'

/**
 * A row shows its length as `51m`, `≈51m` when the length is the category's guess (owner, 2026-10-14, 2026-10-15), and
 * `-` while it is still being looked up. The column is as wide as the widest of them, from the same text.
 */
const PENDING = '-'
const length = (minutes: number, extra: { estimated?: boolean; pending?: boolean } = {}) => ({
  timeToConsumeMinutes: minutes,
  timeToConsumeIsEstimated: extra.estimated ?? false,
  ...(extra.pending ? { runtimePending: true } : {}),
})

describe('lengthLabel', () => {
  it('writes a length that was given as it is', () => {
    expect(lengthLabel(length(51), PENDING)).toBe('51m')
    expect(lengthLabel(length(95), PENDING)).toBe('1h 35m')
  })

  it('marks a length the category guessed with ≈', () => {
    expect(lengthLabel(length(120, { estimated: true }), PENDING)).toBe('≈2h')
  })

  it('writes the mark for a length still being looked up, never ≈ with it', () => {
    expect(lengthLabel(length(120, { estimated: true, pending: true }), PENDING)).toBe('-')
  })
})

describe('minutesColumnWidth', () => {
  it('is at least four characters and one more than the widest label, so the numbers stay apart', () => {
    expect(minutesColumnWidth([length(5)], PENDING)).toBe(5)
    expect(minutesColumnWidth([length(95)], PENDING)).toBe('1h 35m'.length + 1)
  })

  it('counts the ≈ of an estimated length', () => {
    expect(minutesColumnWidth([length(95, { estimated: true })], PENDING)).toBe('≈1h 35m'.length + 1)
  })

  it('is the widest of all the rows', () => {
    expect(minutesColumnWidth([length(5), length(120, { estimated: true }), length(95)], PENDING)).toBe('1h 35m'.length + 1)
  })

  it('counts a pending row for the mark, not for its estimate', () => {
    expect(minutesColumnWidth([length(95, { estimated: true, pending: true })], PENDING)).toBe(4 + 1)
  })

  it('has room for the minimum with no rows', () => {
    expect(minutesColumnWidth([], PENDING)).toBe(5)
  })
})
