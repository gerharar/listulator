import { describe, expect, it } from 'vitest'
import { layerGeometry } from './layerGeometry.js'

describe('layerGeometry', () => {
  it('sits a lone active layer at the 15px baseline, with no transform', () => {
    expect(layerGeometry(1, 0)).toEqual({ top: 15, transform: undefined })
  })

  it('pushes the active layer down to make room for one peeking tab above it', () => {
    expect(layerGeometry(2, 0)).toEqual({ top: 52, transform: undefined })
  })

  it('rises and recedes a layer one step back from the same baseline, clearing a real 34px tab', () => {
    expect(layerGeometry(2, 1)).toEqual({ top: 52, transform: 'translateY(-37px) scale(0.959)' })
  })

  it('pushes the active layer down further to make room for two peeking tabs', () => {
    expect(layerGeometry(3, 0)).toEqual({ top: 89, transform: undefined })
  })

  it('rises and recedes a layer two steps back the most, clearing the tab one step back from it', () => {
    expect(layerGeometry(3, 2)).toEqual({ top: 89, transform: 'translateY(-74px) scale(0.921)' })
  })

  it('every visible layer shares the same top — only transform expresses depth', () => {
    expect(layerGeometry(3, 0).top).toBe(layerGeometry(3, 1).top)
    expect(layerGeometry(3, 1).top).toBe(layerGeometry(3, 2).top)
  })
})
