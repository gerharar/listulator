import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { DEFAULT_EXZED_SKIN, EXZED_SKINS } from './exzedSkins.js'
import { isExzedSkin, resolveExzedSkin, setExzedSkin } from './exzedSkin.js'
import { SKINS } from './skin.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveExzedSkin', () => {
  it.each(EXZED_SKINS)('returns the stored %s: each of the six keys survives a restart', async (skin) => {
    const store = fakeStore()
    await setExzedSkin(store, skin)

    // A new load: another read of the same store.
    expect(await resolveExzedSkin(store)).toBe(skin)
  })

  it('is Lode, exzed-1d, when nothing is stored, and writes nothing', async () => {
    const store = fakeStore()

    expect(await resolveExzedSkin(store)).toBe('exzed-1d')
    expect(DEFAULT_EXZED_SKIN).toBe('exzed-1d')
    expect(store.set).not.toHaveBeenCalled()
  })

  it.each(['exzed-1x', 'exzed-1D', 'exzed-1d ', 'lode', 'Lode', '1d', '', 'undefined'])('is Lode for the unknown stored key %j, and does not rewrite it', async (value) => {
    const store = fakeStore({ exzedSkin: value })

    expect(await resolveExzedSkin(store)).toBe('exzed-1d')
    expect(store.set).not.toHaveBeenCalled()
  })

  it.each(SKINS)('does not take Quantum’s skin %s for one of its own', async (quantumSkin) => {
    expect(await resolveExzedSkin(fakeStore({ exzedSkin: quantumSkin }))).toBe('exzed-1d')
  })

  it('is Lode when the store cannot be read: a rejection and a throw alike', async () => {
    const rejecting: PreferencesStore = { get: () => Promise.reject(new Error('blocked')), set: async () => {} }
    const throwing: PreferencesStore = {
      get: () => {
        throw new Error('blocked')
      },
      set: async () => {},
    }

    expect(await resolveExzedSkin(rejecting)).toBe('exzed-1d')
    expect(await resolveExzedSkin(throwing)).toBe('exzed-1d')
  })

  it('reads only its own key, exzedSkin, and never Quantum’s skin', async () => {
    const store = fakeStore({ skin: 'exzed-1b' })

    expect(await resolveExzedSkin(store)).toBe('exzed-1d')
    expect(store.get).toHaveBeenCalledTimes(1)
    expect(store.get).toHaveBeenCalledWith('exzedSkin')
  })
})

describe('setExzedSkin', () => {
  it('writes the key exzedSkin and nothing else: Quantum’s skin is never touched', async () => {
    const store = fakeStore({ skin: 'dark-violet' })

    await setExzedSkin(store, 'exzed-1l')

    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledWith('exzedSkin', 'exzed-1l')
    expect(await store.get('skin')).toBe('dark-violet')
  })
})

describe('isExzedSkin', () => {
  it('accepts exactly the six keys', () => {
    for (const skin of EXZED_SKINS) expect(isExzedSkin(skin), skin).toBe(true)
    expect(EXZED_SKINS).toHaveLength(6)
    for (const other of ['dark-orange', 'light-bone', 'exzed-1x', '', undefined, 1]) expect(isExzedSkin(other), String(other)).toBe(false)
  })
})
