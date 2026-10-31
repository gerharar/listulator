import { describe, expect, it } from 'vitest'
import { meterPercent, meterState, METER_CELLS } from './MeterBar.js'

describe('meterState (H-024: every bar is 20 cells of 5%, whatever the list’s size)', () => {
  it('always draws 20 cells', () => {
    expect(METER_CELLS).toBe(20)
    for (const total of [0, 1, 7, 20, 21, 598, 50000]) {
      expect(meterState(0, total).n).toBe(20)
    }
  })

  it('draws a 7-item and a 598-item list the same length', () => {
    expect(meterState(3, 7).n).toBe(meterState(299, 598).n)
  })

  it('lights floor(done / total × 20) cells: no partial cell, rounded down', () => {
    expect(meterState(16, 38)).toEqual({ n: 20, f: 8, full: false })
    expect(meterState(3, 7)).toEqual({ n: 20, f: 8, full: false })
    expect(meterState(299, 598)).toEqual({ n: 20, f: 10, full: false })
    expect(meterState(9, 20)).toEqual({ n: 20, f: 9, full: false })
  })

  it('lights at least one cell as soon as anything is done', () => {
    expect(meterState(1, 598)).toEqual({ n: 20, f: 1, full: false })
    expect(meterState(1, 50000)).toEqual({ n: 20, f: 1, full: false })
  })

  it('lights at most 19 cells until every item is done', () => {
    expect(meterState(597, 598)).toEqual({ n: 20, f: 19, full: false })
    expect(meterState(19, 20)).toEqual({ n: 20, f: 19, full: false })
  })

  it('is full, 20 lit cells, only when every item is done', () => {
    expect(meterState(1, 1)).toEqual({ n: 20, f: 20, full: true })
    expect(meterState(598, 598)).toEqual({ n: 20, f: 20, full: true })
  })

  it('lights nothing when nothing is done', () => {
    expect(meterState(0, 1)).toEqual({ n: 20, f: 0, full: false })
    expect(meterState(0, 598)).toEqual({ n: 20, f: 0, full: false })
  })

  it('draws an empty list as 20 empty cells, never full, though done >= total vacuously holds (owner, 2026-10-31)', () => {
    expect(meterState(0, 0)).toEqual({ n: 20, f: 0, full: false })
  })
})

describe('meterPercent (H-024: floor, “100%” only when done, “<1%” when started)', () => {
  it('rounds down, never up', () => {
    expect(meterPercent(16, 38)).toBe('42%')
    expect(meterPercent(2, 3)).toBe('66%')
    expect(meterPercent(1, 3)).toBe('33%')
    expect(meterPercent(4, 105)).toBe('3%')
  })

  it('does the sums in whole numbers, so 29 of 100 is 29% and 7 of 100 is 7% (float division gives 28 and 6)', () => {
    expect(meterPercent(29, 100)).toBe('29%')
    expect(meterPercent(57, 100)).toBe('57%')
    expect(meterState(29, 100).f).toBe(5)
    expect(meterState(15, 100).f).toBe(3)
  })

  it('reads “99%” on 597 of 598, never “100%”', () => {
    expect(meterPercent(597, 598)).toBe('99%')
    expect(meterPercent(999, 1000)).toBe('99%')
  })

  it('reads “100%” only when every item is done', () => {
    expect(meterPercent(598, 598)).toBe('100%')
    expect(meterPercent(1, 1)).toBe('100%')
  })

  it('reads “<1%” when something is done but under 1%, so a started list never reads 0%', () => {
    expect(meterPercent(1, 598)).toBe('<1%')
    expect(meterPercent(1, 101)).toBe('<1%')
    expect(meterPercent(1, 100)).toBe('1%')
  })

  it('reads “0%” when nothing is done, and on an empty list (owner, 2026-10-31)', () => {
    expect(meterPercent(0, 598)).toBe('0%')
    expect(meterPercent(0, 0)).toBe('0%')
  })
})
