import { describe, expect, it } from 'vitest'
import { strippedOfHazards } from './textHazards.js'

describe('strippedOfHazards: a typed text with what disguises or breaks it taken out (a note; owner, 2026-10-15)', () => {
  it('takes out controls, direction overrides and invisible characters', () => {
    expect(strippedOfHazards('a\u0000b‮c​d')).toBe('abcd')
  })

  it('keeps tab, newline and carriage return only when the text may have lines', () => {
    expect(strippedOfHazards('a\tb\nc')).toBe('abc')
    expect(strippedOfHazards('a\tb\nc', true)).toBe('a\tb\nc')
  })

  it('keeps what people really write: joiners in emoji, accents, letter marks', () => {
    const text = '👩‍💻 café ‏ab'
    expect(strippedOfHazards(text, true)).toBe(text)
  })
})
