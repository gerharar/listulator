// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { layerGeometry } from './layerGeometry.js'

/**
 * The peek cascade is the page's own numbers (Phase 48.4c, design's answer 4): what a step back rises by (`--peek-rise`: 37px in Quantum, 40px in
 * eX-Zed, where the board puts the tab tops 40 and 80px above the window and lets the window's rings cover the lower part of a 48px tab), the scale
 * each step recedes to (`--peek-scale-1` and `-2`: .959 and .921 in Quantum, 1 in eX-Zed, which must not put pixels between pixels) and how far
 * a layer is inset on each side (`--peek-inset-1` and `-2`: none in Quantum; in eX-Zed one back is as wide as the window in front and two back is
 * 32px narrower each side, which replaces the recede). There is no clearance rule: the rise is the board's, not the tab's height plus something.
 */
const html = document.documentElement
const TOKENS = ['--peek-rise', '--peek-scale-1', '--peek-scale-2', '--peek-inset-1', '--peek-inset-2', '--tab-h']

afterEach(() => TOKENS.forEach((name) => html.style.removeProperty(name)))

const exzed = () => {
  html.style.setProperty('--peek-rise', '40px')
  html.style.setProperty('--peek-scale-1', '1')
  html.style.setProperty('--peek-scale-2', '1')
  html.style.setProperty('--peek-inset-1', '0px')
  html.style.setProperty('--peek-inset-2', '32px')
}

describe('layerGeometry with the page’s numbers', () => {
  it('is Quantum’s 37 and 74px, .959 and .921, and no inset, where the page sets nothing', () => {
    expect(layerGeometry(2, 1)).toEqual({ top: 52, transform: 'translateY(-37px) scale(0.959)' })
    expect(layerGeometry(3, 2)).toEqual({ top: 89, transform: 'translateY(-74px) scale(0.921)' })
    expect(layerGeometry(3, 2).inset).toBeUndefined()
  })

  it('does not follow the tab’s height any more: the rise is its own number', () => {
    html.style.setProperty('--tab-h', '48px')

    expect(layerGeometry(2, 1).transform).toBe('translateY(-37px) scale(0.959)')
  })

  it('rises 40 and 80px, at scale 1, for eX-Zed: the tab tops of the board', () => {
    exzed()

    expect(layerGeometry(1, 0)).toEqual({ top: 15, transform: undefined })
    expect(layerGeometry(2, 0)).toEqual({ top: 15 + 40, transform: undefined })
    expect(layerGeometry(2, 1).transform).toBe('translateY(-40px) scale(1)')
    expect(layerGeometry(3, 0).top).toBe(15 + 80)
    expect(layerGeometry(3, 2).transform).toBe('translateY(-80px) scale(1)')
  })

  it('insets only the layer two back, by 32px a side, for eX-Zed; the active layer and the one back have none', () => {
    exzed()

    expect(layerGeometry(3, 2).inset).toBe(32)
    expect(layerGeometry(3, 1).inset).toBeUndefined()
    expect(layerGeometry(3, 0).inset).toBeUndefined()
    expect(layerGeometry(2, 1).inset).toBeUndefined()
  })

  it('stops at the deepest step, as before: a fourth layer is not drawn deeper than the third', () => {
    exzed()

    expect(layerGeometry(5, 4)).toEqual(layerGeometry(3, 2))
  })
})
