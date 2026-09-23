import { describe, expect, it } from 'vitest'
import { meterCellNote, meterCellsPerItem, meterState, METER_CELL_CAP } from './MeterBar.js'

describe('meterState', () => {
  it('handles an empty list (0 items)', () => {
    expect(meterState(0, 0)).toEqual({ n: 0, f: 0, full: false })
  })

  it('handles a single-item list (1 item), empty and full', () => {
    expect(meterState(0, 1)).toEqual({ n: 1, f: 0, full: false })
    expect(meterState(1, 1)).toEqual({ n: 1, f: 1, full: true })
  })

  it('handles a list exactly at the cap (20 items)', () => {
    expect(meterState(0, 20)).toEqual({ n: 20, f: 0, full: false })
    expect(meterState(9, 20)).toEqual({ n: 20, f: 9, full: false })
    expect(meterState(20, 20)).toEqual({ n: 20, f: 20, full: true })
  })

  it('handles a list one item past the cap (21 items)', () => {
    expect(meterState(0, 21)).toEqual({ n: 20, f: 0, full: false })
    expect(meterState(10, 21)).toEqual({ n: 20, f: 10, full: false })
    expect(meterState(21, 21)).toEqual({ n: 20, f: 20, full: true })
  })

  it('handles a large list (598 items), each cell standing for a block', () => {
    expect(meterState(0, 598)).toEqual({ n: 20, f: 0, full: false })
    expect(meterState(299, 598)).toEqual({ n: 20, f: 10, full: false })
    expect(meterState(598, 598)).toEqual({ n: 20, f: 20, full: true })
  })

  it("matches the design system's own worked example: 16 of 38 done", () => {
    expect(meterState(16, 38)).toEqual({ n: 20, f: 8, full: false })
  })

  it('is never "full" on an empty list, even though done >= total vacuously holds', () => {
    expect(meterState(0, 0).full).toBe(false)
  })
})

describe('meterCellsPerItem', () => {
  it('is 1 at or under the cap', () => {
    expect(meterCellsPerItem(1)).toBe(1)
    expect(meterCellsPerItem(METER_CELL_CAP)).toBe(1)
  })

  it("rounds up past the cap, matching the design system's 598-item example (30 items each)", () => {
    expect(meterCellsPerItem(598)).toBe(30)
  })

  it('rounds up for a total that does not divide evenly', () => {
    expect(meterCellsPerItem(21)).toBe(2)
  })
})

describe('meterCellNote', () => {
  it('reads "one cell = one item" at or under the cap', () => {
    expect(meterCellNote(1)).toBe('One cell = one item')
    expect(meterCellNote(METER_CELL_CAP)).toBe('One cell = one item')
  })

  it('names the block size past the cap', () => {
    expect(meterCellNote(598)).toBe('20 cells ≈ 30 items each')
  })
})
