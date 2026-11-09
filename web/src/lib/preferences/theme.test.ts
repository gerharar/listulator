import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { effectiveTheme, isTheme, resolveTheme, setTheme, THEMES } from './theme.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveTheme', () => {
  it.each(THEMES)('returns the stored %s', async (theme) => {
    expect(await resolveTheme(fakeStore({ theme }))).toBe(theme)
  })

  it('is Quantum when nothing is stored, and writes nothing (the choice arrives with X-003)', async () => {
    const store = fakeStore()

    expect(await resolveTheme(store)).toBe('quantum')
    expect(store.set).not.toHaveBeenCalled()
  })

  it.each(['Exzed', 'EXZED', 'sci-fi', 'dark-blue', 'exzed ', ''])('is Quantum for the unknown stored value %j', async (value) => {
    expect(await resolveTheme(fakeStore({ theme: value }))).toBe('quantum')
  })

  it('is Quantum when the store cannot be read: a rejection and a throw alike', async () => {
    const rejecting: PreferencesStore = { get: () => Promise.reject(new Error('blocked')), set: async () => {} }
    const throwing: PreferencesStore = {
      get: () => {
        throw new Error('blocked')
      },
      set: async () => {},
    }

    expect(await resolveTheme(rejecting)).toBe('quantum')
    expect(await resolveTheme(throwing)).toBe('quantum')
  })

  it('reads only the key `theme`, never the old six-theme system’s `listulator:theme`', async () => {
    const store = fakeStore({ 'listulator:theme': 'exzed' })

    expect(await resolveTheme(store)).toBe('quantum')
    expect(store.get).toHaveBeenCalledTimes(1)
    expect(store.get).toHaveBeenCalledWith('theme')
  })
})

describe('setTheme', () => {
  it.each(THEMES)('writes %s under the key `theme` and resolveTheme reads it back', async (theme) => {
    const store = fakeStore()

    await setTheme(store, theme)

    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledWith('theme', theme)
    expect(await resolveTheme(store)).toBe(theme)
  })

  it('writes the theme and nothing else: neither skin is touched', async () => {
    const store = fakeStore({ skin: 'dark-green', exzedSkin: 'exzed-1c' })

    await setTheme(store, 'exzed')

    expect(await store.get('skin')).toBe('dark-green')
    expect(await store.get('exzedSkin')).toBe('exzed-1c')
  })
})

describe('isTheme', () => {
  it('accepts exactly the two themes', () => {
    expect(THEMES).toEqual(['quantum', 'exzed'])
    expect(isTheme('quantum')).toBe(true)
    expect(isTheme('exzed')).toBe(true)
    expect(isTheme('dark-orange')).toBe(false)
    expect(isTheme(undefined)).toBe(false)
  })
})

describe('effectiveTheme', () => {
  // eX-Zed is a desktop theme (design, answer 8): the stored theme holds where the device has a fine pointer that can hover; a touch-only device is Quantum,
  // and what is stored is only read, never rewritten, because the preference may be shared with a desktop.
  it.each(THEMES)('is the stored %s where the device has a fine pointer', (theme) => {
    expect(effectiveTheme(theme, true)).toBe(theme)
  })

  it.each(THEMES)('is Quantum on a touch-only device, whatever is stored (%s)', (theme) => {
    expect(effectiveTheme(theme, false)).toBe('quantum')
  })
})
