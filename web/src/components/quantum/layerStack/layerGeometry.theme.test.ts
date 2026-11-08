// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { layerGeometry } from './layerGeometry.js'

/**
 * The peek cascade's rise is the room a covered layer's tab needs above the layer in front (Phase 48.4): the tab's height (`--tab-h`, 34px in
 * Quantum, 48px in eX-Zed) and its 3px (a 2px offset and a 1px border). In Quantum that is the 37 and 74px the cascade has always risen by; a
 * taller tab rises further, or the layer in front would cover it. The scale of the cascade, and what eX-Zed does instead of it (an inset), are not
 * part of this: X-007 and design.
 */
const html = document.documentElement

afterEach(() => html.style.removeProperty('--tab-h'))

describe('layerGeometry with the page’s tab height', () => {
  it('is Quantum’s 37 and 74px for a 34px tab, and the same when the page sets nothing', () => {
    expect(layerGeometry(2, 1).transform).toBe('translateY(-37px) scale(0.959)')
    expect(layerGeometry(3, 2).transform).toBe('translateY(-74px) scale(0.921)')

    html.style.setProperty('--tab-h', '34px')
    expect(layerGeometry(2, 1)).toEqual({ top: 52, transform: 'translateY(-37px) scale(0.959)' })
    expect(layerGeometry(3, 2)).toEqual({ top: 89, transform: 'translateY(-74px) scale(0.921)' })
  })

  it('rises a 48px tab’s whole height and its 3px per step back: 51 and 102px', () => {
    html.style.setProperty('--tab-h', '48px')

    expect(layerGeometry(1, 0)).toEqual({ top: 15, transform: undefined })
    expect(layerGeometry(2, 0)).toEqual({ top: 15 + 51, transform: undefined })
    expect(layerGeometry(2, 1).transform).toBe('translateY(-51px) scale(0.959)')
    expect(layerGeometry(3, 0).top).toBe(15 + 102)
    expect(layerGeometry(3, 2).transform).toBe('translateY(-102px) scale(0.921)')
  })

  it('stops at the deepest step, as before: a fourth layer is not drawn deeper than the third', () => {
    html.style.setProperty('--tab-h', '48px')

    expect(layerGeometry(5, 4).transform).toBe(layerGeometry(3, 2).transform)
  })
})
