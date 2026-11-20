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

  it('with nothing stored picks one of the six at random, Lotus included, and stores the pick at once (H-030, rule 3)', async () => {
    const store = fakeStore()

    const skin = await resolveExzedSkin(store, () => 0.99) // the last of the six, the light one

    expect(skin).toBe('exzed-1l')
    expect(await store.get('exzedSkin')).toBe('exzed-1l')
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it('spreads the pick across all six skins, in design’s order', async () => {
    // Sixths, each a little over its lower edge, land on the 6 indices (Math.floor(fraction * 6)): 0 to 5, a fresh store each time.
    const picks = await Promise.all([0, 1 / 6 + 0.01, 2 / 6 + 0.01, 3 / 6 + 0.01, 4 / 6 + 0.01, 5 / 6 + 0.01].map((fraction) => resolveExzedSkin(fakeStore(), () => fraction)))

    expect(picks).toEqual([...EXZED_SKINS])
  })

  it('does not draw again once a skin is stored: a stored one is returned as is, whatever the dice say', async () => {
    const store = fakeStore({ exzedSkin: 'exzed-1b' })
    const random = vi.fn(() => 0.99)

    expect(await resolveExzedSkin(store, random)).toBe('exzed-1b')
    expect(random).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })

  it.each(['exzed-1x', 'exzed-1D', 'exzed-1d ', 'lode', 'Lode', '1d', '', 'undefined'])('is Lode for the unknown stored key %j, and does not rewrite it', async (value) => {
    const store = fakeStore({ exzedSkin: value })

    expect(await resolveExzedSkin(store, () => 0.99)).toBe('exzed-1d')
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

    expect(await resolveExzedSkin(rejecting, () => 0.99)).toBe('exzed-1d')
    expect(await resolveExzedSkin(throwing, () => 0.99)).toBe('exzed-1d')
  })

  it('is Lode when nothing is stored and the pick cannot be written: the same skin every launch, not a new one each time', async () => {
    const unwritable: PreferencesStore = { get: async () => undefined, set: () => Promise.reject(new Error('blocked')) }

    expect(await resolveExzedSkin(unwritable, () => 0.99)).toBe(DEFAULT_EXZED_SKIN)
    expect(DEFAULT_EXZED_SKIN, 'Lode is the fallback, and design’s first skin').toBe('exzed-1d')
  })

  it('reads only its own key, exzedSkin, and never Quantum’s skin', async () => {
    const store = fakeStore({ skin: 'exzed-1b' })

    expect(await resolveExzedSkin(store, () => 0.99)).toBe('exzed-1l')
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
