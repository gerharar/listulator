import { describe, expect, it } from 'vitest'
import { combineVirtualization, parseVirtualization } from './listVirtualization.js'

/** The switch for drawing only the rows in view on a long list (Phase 25.7): one parser for the server's variable and the app's preference. */
describe('parseVirtualization', () => {
  it('reads `off` in the ways a person writes it by hand, in any case, with spaces around', () => {
    for (const value of ['off', 'OFF', ' Off ', 'false', 'FALSE', '0', 'no', 'No']) {
      expect(parseVirtualization(value)).toBe('off')
    }
  })

  it('reads `auto` the same way, and a missing or empty value as `auto` (the default)', () => {
    for (const value of ['auto', 'AUTO', ' auto ', '', '   ']) expect(parseVirtualization(value)).toBe('auto')
    expect(parseVirtualization(undefined)).toBe('auto')
    expect(parseVirtualization(null)).toBe('auto')
  })

  it('answers `undefined` for anything it does not understand, so a caller can refuse it or fall back', () => {
    for (const value of ['maybe', 'on', 'true', '1', 'off!', 'of f']) expect(parseVirtualization(value)).toBeUndefined()
  })

  it('takes what a JSON file may hold: a boolean or a number', () => {
    expect(parseVirtualization(false)).toBe('off')
    expect(parseVirtualization(0)).toBe('off')
    expect(parseVirtualization(true)).toBeUndefined()
    expect(parseVirtualization(1)).toBeUndefined()
  })
})

describe('combineVirtualization', () => {
  it('is off when ANY source says off: the switch is a safety net, so no source can force it back on', () => {
    expect(combineVirtualization('auto', 'auto')).toBe('auto')
    expect(combineVirtualization('off', 'auto')).toBe('off')
    expect(combineVirtualization('auto', 'off')).toBe('off')
    expect(combineVirtualization('off', 'off')).toBe('off')
    expect(combineVirtualization()).toBe('auto')
  })
})
