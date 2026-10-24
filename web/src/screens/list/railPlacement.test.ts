import { describe, expect, it } from 'vitest'
import { cardMargin, layerBorderWidth, listCardWidth, outsideRailWidth, railPlacement } from './railPlacement.js'

/** H-019: the jump rail sits inside the card or outside it, decided by the window and the card alone. */

describe('cardMargin', () => {
  it('is the room beside the card: the window minus its 40px of inset, minus the card, halved', () => {
    expect(cardMargin(1552)).toBe(216)
    expect(cardMargin(1920)).toBe(400)
  })

  it('is nothing while the card fills the window', () => {
    expect(cardMargin(1120)).toBe(0)
    expect(cardMargin(800)).toBe(0)
  })
})

describe('railPlacement', () => {
  it('goes outside from a left margin of 216px (window 1552), with the default 200px rail and 16px of air', () => {
    expect(railPlacement(1551, 'inside')).toBe('inside')
    expect(railPlacement(1552, 'inside')).toBe('outside')
  })

  it('is inside on the laptops that have no room: 1440 and 1512', () => {
    expect(railPlacement(1440, 'inside')).toBe('inside')
    expect(railPlacement(1512, 'inside')).toBe('inside')
  })

  it('is outside on a 1728 or 1920 full screen', () => {
    expect(railPlacement(1728, 'inside')).toBe('outside')
    expect(railPlacement(1920, 'inside')).toBe('outside')
  })

  it('goes back inside only below 200px of margin (window 1520), so a window dragged near the line does not flicker', () => {
    expect(railPlacement(1521, 'outside')).toBe('outside')
    expect(railPlacement(1520, 'outside')).toBe('outside')
    expect(railPlacement(1519, 'outside')).toBe('inside')
  })

  it('stays inside between 200px and 216px of margin when it started inside', () => {
    expect(railPlacement(1530, 'inside')).toBe('inside')
    expect(railPlacement(1530, 'outside')).toBe('outside')
  })
})

describe('outsideRailWidth', () => {
  it('is the stored width while the margin leaves 16px beyond it', () => {
    expect(outsideRailWidth(200, 216)).toBe(200)
    expect(outsideRailWidth(324, 400)).toBe(324)
  })

  it('is capped at the margin minus 16px, so the rail never touches the window edge', () => {
    expect(outsideRailWidth(480, 300)).toBe(284)
  })
})

describe('listCardWidth', () => {
  it('is the full 1080px when centring leaves a whole pixel on each side', () => {
    expect(listCardWidth(1920)).toBe(1080)
    expect(listCardWidth(1552)).toBe(1080)
  })

  it('gives up 1px at an odd window width, so centring leaves an even remainder (no half pixel, no seam)', () => {
    expect(listCardWidth(1921)).toBe(1079)
    expect(listCardWidth(1553)).toBe(1079)
  })

  it('leaves a card narrower than 1080px alone', () => {
    expect(listCardWidth(1001)).toBe(null)
    expect(listCardWidth(1120)).toBe(1080)
  })
})

describe('layerBorderWidth', () => {
  it('is the 2px border at a screen scale that makes it whole device pixels', () => {
    expect(layerBorderWidth(1)).toBeCloseTo(2, 2)
    expect(layerBorderWidth(2)).toBeCloseTo(2, 2)
    expect(layerBorderWidth(1.5)).toBeCloseTo(2, 2)
  })

  it('is the width the browser draws at 125% (1.6px = 2 device pixels), so an offset by it lands on the border’s edge', () => {
    expect(layerBorderWidth(1.25)).toBeCloseTo(1.6, 2)
    expect(layerBorderWidth(1.5625)).toBeCloseTo(1.92, 2)
  })

  it('is a whole number of device pixels, never fewer than one, and never rounds below it (the browser floors a border)', () => {
    for (const ratio of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const device = layerBorderWidth(ratio) * ratio

      expect(device).toBeGreaterThanOrEqual(Math.max(1, Math.floor(2 * ratio)))
      expect(device).toBeLessThan(Math.max(1, Math.floor(2 * ratio)) + 0.05)
    }
  })

  it('falls back to 2px for a ratio that is not a number above zero', () => {
    expect(layerBorderWidth(0)).toBe(2)
    expect(layerBorderWidth(Number.NaN)).toBe(2)
  })
})
