import { describe, expect, it } from 'vitest'
import { isThemeKey, persistTheme, resolveInitialTheme } from './theme.js'

const throwingStorage = {
  getItem: () => {
    throw new Error('site data blocked')
  },
  setItem: () => {
    throw new Error('site data blocked')
  },
}

describe('theme selection', () => {
  it('prefers a remembered choice over the OS setting', () => {
    const storage = { getItem: () => 'brown' }

    expect(resolveInitialTheme(storage, true)).toBe('brown')
  })

  it('follows the OS when nothing is remembered', () => {
    const storage = { getItem: () => null }

    expect(resolveInitialTheme(storage, true)).toBe('dn')
    expect(resolveInitialTheme(storage, false)).toBe('bone')
  })

  it('ignores a stored value that is not a real theme', () => {
    const storage = { getItem: () => 'chartreuse' }

    expect(resolveInitialTheme(storage, false)).toBe('bone')
  })

  it('survives storage being unavailable', () => {
    // Private windows and blocked site data throw on access rather than
    // returning null — that must not take the page down.
    expect(() => resolveInitialTheme(throwingStorage, true)).not.toThrow()
    expect(resolveInitialTheme(throwingStorage, true)).toBe('dn')
    expect(() => persistTheme(throwingStorage, 'dark')).not.toThrow()
    expect(() => resolveInitialTheme(undefined, false)).not.toThrow()
  })

  it('recognises exactly the shipped themes', () => {
    expect(isThemeKey('dn')).toBe(true)
    expect(isThemeKey('white')).toBe(true)
    expect(isThemeKey('nope')).toBe(false)
    expect(isThemeKey(null)).toBe(false)
  })
})
