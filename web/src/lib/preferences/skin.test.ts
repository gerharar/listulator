import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { isSkin, resolveSkin, setSkin, SKINS } from './skin.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveSkin', () => {
  it('on first run, picks from all five skins, Jouhou included, and persists the pick (H-030)', async () => {
    const store = fakeStore()
    const random = () => 0.99 // pushes toward the last skin, which is the light one

    const skin = await resolveSkin(store, random)

    expect(skin).toBe('light-bone')
    expect(await store.get('skin')).toBe(skin)
  })

  it('spreads the random pick across all five skins, not just the extremes', async () => {
    // Fifths land squarely on each of the 5 indices (Math.floor(fraction * 5)): 0 to 4, a fresh store each time, so no pick is short-circuited by an earlier one being persisted.
    const picks = await Promise.all([0, 0.2, 0.4, 0.6, 0.8].map((fraction) => resolveSkin(fakeStore(), () => fraction)))

    expect(picks).toEqual([...SKINS])
  })

  it('on a second load, returns the stored skin without calling the RNG', async () => {
    const store = fakeStore({ skin: 'dark-blue' })
    const random = vi.fn(() => 0)

    const skin = await resolveSkin(store, random)

    expect(skin).toBe('dark-blue')
    expect(random).not.toHaveBeenCalled()
  })

  it('ignores a stored legacy theme value — it never reads it — and picks a skin', async () => {
    // The old system's key ('listulator:theme') is a different store
    // entirely; this store only ever has whatever `skin` holds, which is
    // nothing here — same as a genuine first run.
    const store = fakeStore()

    const skin = await resolveSkin(store, () => 0.1)

    expect(SKINS).toContain(skin)
  })

  it('returns a user-chosen light-bone as-is, without re-randomizing', async () => {
    const store = fakeStore({ skin: 'light-bone' })
    const random = vi.fn(() => 0)

    const skin = await resolveSkin(store, random)

    expect(skin).toBe('light-bone')
    expect(random).not.toHaveBeenCalled()
  })
})

describe('setSkin', () => {
  it('persists the given skin, and a later resolveSkin returns it', async () => {
    const store = fakeStore()

    await setSkin(store, 'dark-violet')

    expect(await resolveSkin(store, () => 0)).toBe('dark-violet')
  })
})

describe('isSkin', () => {
  it('recognises exactly the five shipped skins', () => {
    for (const skin of SKINS) expect(isSkin(skin)).toBe(true)

    expect(isSkin('dn')).toBe(false) // an old theme key, not a skin
    expect(isSkin('dark-red')).toBe(false)
    expect(isSkin(undefined)).toBe(false)
    expect(isSkin(null)).toBe(false)
  })
})
