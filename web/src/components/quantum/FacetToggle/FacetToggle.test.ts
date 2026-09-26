import { describe, expect, it } from 'vitest'
import { isAllOn, toggleFacetOption } from './FacetToggle.js'

describe('isAllOn', () => {
  it('is on exactly when no option is selected', () => {
    expect(isAllOn(new Set())).toBe(true)
  })

  it('is off as soon as any option is selected', () => {
    expect(isAllOn(new Set(['ps3']))).toBe(false)
  })

  it('stays off with more than one option selected', () => {
    expect(isAllOn(new Set(['ps3', 'x360']))).toBe(false)
  })
})

describe('toggleFacetOption', () => {
  it('adds an option that was not selected', () => {
    expect(toggleFacetOption(new Set(), 'ps3')).toEqual(new Set(['ps3']))
  })

  it('removes an option that was selected, leaving the rest untouched', () => {
    const selected = new Set(['ps3', 'x360'])

    expect(toggleFacetOption(selected, 'ps3')).toEqual(new Set(['x360']))
  })

  it('turns into All when the last option goes on: every option on hides nothing (U1)', () => {
    expect(toggleFacetOption(new Set(['movie']), 'tv', ['movie', 'tv'])).toEqual(new Set())
  })

  it('stays a selection while any option is still off', () => {
    expect(toggleFacetOption(new Set(['movie']), 'tv', ['movie', 'tv', 'game'])).toEqual(new Set(['movie', 'tv']))
  })

  it('does not mutate the set it was given', () => {
    const selected = new Set(['ps3'])

    toggleFacetOption(selected, 'x360')

    expect(selected).toEqual(new Set(['ps3']))
  })
})
