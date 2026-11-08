import { describe, expect, it } from 'vitest'
import { activeSkin } from './activeSkin.js'

describe('activeSkin', () => {
  it('is Quantum’s skin in Quantum, whatever eX-Zed’s is', () => {
    expect(activeSkin('quantum', { quantum: 'dark-violet', exzed: 'exzed-1b' })).toBe('dark-violet')
  })

  it('is eX-Zed’s skin in eX-Zed, whatever Quantum’s is: the page never carries the other theme’s key', () => {
    expect(activeSkin('exzed', { quantum: 'dark-violet', exzed: 'exzed-1b' })).toBe('exzed-1b')
  })
})
