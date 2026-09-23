import { describe, expect, it } from 'vitest'
import { plateParams, SKIN_PLATE_VARIANT } from './HeaderPlate.js'

describe('SKIN_PLATE_VARIANT', () => {
  it("assigns each of the five skins its own plate variant, matching the engine's SKIN_PLATE table", () => {
    expect(SKIN_PLATE_VARIANT).toEqual({
      'dark-orange': 1,
      'dark-violet': 2,
      'dark-green': 3,
      'dark-blue': 4,
      'light-bone': 5,
    })
  })
})

describe('plateParams', () => {
  it('variant 1 (dark-orange): wrap/hatch angle and period at seed 0, side left', () => {
    expect(plateParams('dark-orange', 'left', 0)).toEqual({
      variant: 1,
      dir: 104,
      wrapAngle: 104,
      hatchAngle: 118,
      hatchPeriod: 22,
    })
  })

  it('variant 1: side right uses 256°, and a non-zero seed nudges every value', () => {
    const p = plateParams('dark-orange', 'right', 3)
    expect(p.dir).toBe(256)
    expect(p.wrapAngle).toBe(256 + 3 * 4) // 268
    expect(p.hatchAngle).toBe(118 + 3 * 9) // 145
    expect(p.hatchPeriod).toBe(22 + 3 * 3) // 31
  })

  it('variant 2 (dark-violet): wrap/hatch, plus the scanline angle/period', () => {
    const p = plateParams('dark-violet', 'left', 0)
    expect(p.variant).toBe(2)
    expect(p.wrapAngle).toBe(104 - 10 + 0 * 6) // 94
    expect(p.hatchAngle).toBe(101)
    expect(p.hatchPeriod).toBe(37)
    expect(p.scanlineAngle).toBe(178) // seed 0 is even -> 178
    expect(p.scanlinePeriod).toBe(9)
  })

  it('variant 2: scanline angle alternates on seed parity (sd % 2 ? 182 : 178)', () => {
    expect(plateParams('dark-violet', 'left', 0).scanlineAngle).toBe(178)
    expect(plateParams('dark-violet', 'left', 1).scanlineAngle).toBe(182)
    expect(plateParams('dark-violet', 'left', 2).scanlineAngle).toBe(178)
    expect(plateParams('dark-violet', 'left', 3).scanlineAngle).toBe(182)
  })

  it('variant 3 (dark-green): wrap angle, and the three hatch angles/periods', () => {
    const p = plateParams('dark-green', 'left', 2)
    expect(p.variant).toBe(3)
    expect(p.wrapAngle).toBe(104 + 2 * 7) // 118
    expect(p.hatchAngle).toEqual([17 + 2 * 5, -41 - 2 * 3, 78 + 2 * 4]) // [27, -47, 86]
    expect(p.hatchPeriod).toEqual([23 + 2, 37 + 2, 53 + 2]) // [25, 39, 55]
  })

  it('variant 4 (dark-blue): wrap angle, ring hatch period, and the rule texture period', () => {
    const p = plateParams('dark-blue', 'right', 1)
    expect(p.variant).toBe(4)
    expect(p.wrapAngle).toBe(256 + 1 * 4) // 260
    expect(p.hatchPeriod).toBe(25 + 1 * 3) // 28
    expect(p.rulePeriod).toBe(7 + 1) // 8
  })

  it('variant 5 (light-bone): no wrap angle (the band is a fixed gradient) — only hatch and the arc offset', () => {
    const p = plateParams('light-bone', 'left', 4)
    expect(p.variant).toBe(5)
    expect(p.wrapAngle).toBeUndefined()
    expect(p.hatchAngle).toBe(64 + 4 * 4) // 80
    expect(p.hatchPeriod).toBe(25 + 4 * 3) // 37
    expect(p.arcOffset).toBe(18 + 4 * 40) // 178
  })
})
