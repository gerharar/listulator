import { describe, expect, it } from 'vitest'
import { platformChipLabel, platformFullName, PLATFORMS } from './PlatformChip.js'

describe('platformChipLabel', () => {
  it('shows a single named platform as its own code', () => {
    expect(platformChipLabel(['PS3'])).toBe('PS3')
  })

  it('collapses more than one named platform to MULTI', () => {
    expect(platformChipLabel(['PS3', 'X360', 'PC'])).toBe('MULTI')
  })

  it('shows the literal multi tag as MULTI', () => {
    expect(platformChipLabel(['multi'])).toBe('MULTI')
  })

  it('is an empty slot — null — when the item carries no platform tags', () => {
    expect(platformChipLabel([])).toBeNull()
  })

  it('shows an unknown code as its own caps text, same as a known one', () => {
    expect(platformChipLabel(['dreamcast'])).toBe('DREAMCAST')
  })
})

describe('platformFullName', () => {
  it('looks up a known code case-insensitively', () => {
    expect(platformFullName('ps3')).toBe('PlayStation 3')
    expect(platformFullName('PS3')).toBe('PlayStation 3')
  })

  it('is null for a code the table does not carry', () => {
    expect(platformFullName('dreamcast')).toBeNull()
  })

  it('carries every code PLATFORMS declares', () => {
    for (const code of Object.keys(PLATFORMS)) {
      expect(platformFullName(code)).toBe(PLATFORMS[code])
    }
  })
})
