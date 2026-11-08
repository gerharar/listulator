// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cardMargin, carriedRailWidth, CARRY_FLOOR_WIDTH, carryFloorWidth, listCardWidth, QUANTUM_GEOMETRY, railGeometry, railPlacement, shownRailWidth } from './railPlacement.js'

/**
 * The rail's rule reads the card's cap and the stage's side gap from the page (Phase 48.4): the same tokens the CSS draws the card with
 * (`--layer-max-list`, `--stage-gap`), so a theme's card and the rule that places the rail cannot disagree. eX-Zed (design, answer 3): a 1620px list
 * card and a 96px gap, which is 1620 + 2 x 96 + 2 x 216 = 2244px before the rail goes outside; Quantum: 1080 and 20, which is 1552.
 */
const html = document.documentElement
const EXZED = { cardMax: 1620, inset: 96 }

afterEach(() => {
  html.style.removeProperty('--layer-max-list')
  html.style.removeProperty('--stage-gap')
})

describe('railGeometry', () => {
  it('is Quantum’s 1080 and 20 where the page sets nothing', () => {
    expect(railGeometry()).toEqual({ cardMax: 1080, inset: 20 })
    expect(QUANTUM_GEOMETRY).toEqual({ cardMax: 1080, inset: 20 })
  })

  it('is the page’s tokens when it sets them', () => {
    html.style.setProperty('--layer-max-list', '1620px')
    html.style.setProperty('--stage-gap', '96px')

    expect(railGeometry()).toEqual(EXZED)
  })
})

describe('the rule with eX-Zed’s card and gap', () => {
  it('leaves 216px on each side at 2244 and puts the rail outside from there', () => {
    expect(cardMargin(2244, EXZED)).toBe(216)
    expect(railPlacement(2243, 'inside', EXZED)).toBe('inside')
    expect(railPlacement(2244, 'inside', EXZED)).toBe('outside')
  })

  it('keeps its 16px of hysteresis: outside holds down to a 200px margin, back inside below 2212', () => {
    expect(railPlacement(2212, 'outside', EXZED)).toBe('outside')
    expect(railPlacement(2211, 'outside', EXZED)).toBe('inside')
  })

  it('leaves a 374px margin at 2560, so the rail may be 358px wide there', () => {
    expect(cardMargin(2560, EXZED)).toBe(374)
    expect(shownRailWidth(480, { placement: 'outside', windowWidth: 2560 }, EXZED)).toBe(358)
  })

  it('has no margin while the window is narrower than the card and its gaps', () => {
    expect(cardMargin(1812, EXZED)).toBe(0)
    expect(cardMargin(1440, EXZED)).toBe(0)
  })

  it('gives the card its cap, a pixel less when the remainder is odd, and none while the window is narrower than that', () => {
    expect(listCardWidth(1812, EXZED)).toBe(1620)
    expect(listCardWidth(2244, EXZED)).toBe(1620)
    expect(listCardWidth(2245, EXZED)).toBe(1619)
    expect(listCardWidth(1811, EXZED)).toBe(null)
    expect(listCardWidth(1440, EXZED)).toBe(null)
  })

  it('carries a rail inside down to a 160px floor that is the card, the gaps and two minimum rails away', () => {
    expect(carryFloorWidth(EXZED)).toBe(2 * (160 + 16) + 1620 + 2 * 96)
    expect(carriedRailWidth(480, carryFloorWidth(EXZED), EXZED)).toBe(160)
    expect(carriedRailWidth(480, carryFloorWidth(EXZED) + 2, EXZED)).toBeGreaterThan(160)
  })

  it('caps an outside rail by the margin it has', () => {
    expect(shownRailWidth(480, { placement: 'outside', windowWidth: 2244 }, EXZED)).toBe(200)
  })
})

describe('with no geometry given, the rule reads the page', () => {
  it('is Quantum’s without a theme: outside from 1552, and the carry floor is the exported constant', () => {
    expect(railPlacement(1551, 'inside')).toBe('inside')
    expect(railPlacement(1552, 'inside')).toBe('outside')
    expect(carryFloorWidth()).toBe(CARRY_FLOOR_WIDTH)
  })

  it('is the page’s tokens’ when a theme sets them: 2000px is outside for Quantum’s card and inside for eX-Zed’s', () => {
    expect(railPlacement(2000, 'inside')).toBe('outside')

    html.style.setProperty('--layer-max-list', '1620px')
    html.style.setProperty('--stage-gap', '96px')

    expect(railPlacement(2000, 'inside')).toBe('inside')
    expect(railPlacement(2244, 'inside')).toBe('outside')
    expect(listCardWidth(2244)).toBe(1620)
  })
})
