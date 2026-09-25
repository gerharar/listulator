import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import {
  isMotion,
  MOTIONS,
  resolveMotion,
  resolveReducedMotionSetting,
  setMotion,
  setReducedMotionSetting,
} from './motion.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveMotion', () => {
  it('is the drum carousel when nothing is stored', async () => {
    expect(await resolveMotion(fakeStore())).toBe('drum')
  })

  it('returns a stored fast push', async () => {
    expect(await resolveMotion(fakeStore({ motion: 'push' }))).toBe('push')
  })

  it('falls back to the drum for a stored value that is not a known mode', async () => {
    expect(await resolveMotion(fakeStore({ motion: 'deck' }))).toBe('drum')
  })
})

describe('setMotion', () => {
  it('persists the mode, and a later resolveMotion returns it', async () => {
    const store = fakeStore()

    await setMotion(store, 'push')

    expect(await resolveMotion(store)).toBe('push')
  })
})

describe('isMotion', () => {
  it('recognises exactly the shipped modes', () => {
    for (const motion of MOTIONS) expect(isMotion(motion)).toBe(true)
    expect(isMotion('deck')).toBe(false)
    expect(isMotion(undefined)).toBe(false)
  })
})

describe('reduced-motion setting', () => {
  it('is undefined — "follow the system" — until the user has chosen', async () => {
    expect(await resolveReducedMotionSetting(fakeStore())).toBeUndefined()
  })

  it('remembers an explicit yes and an explicit no apart from "never chosen"', async () => {
    const store = fakeStore()

    await setReducedMotionSetting(store, true)
    expect(await resolveReducedMotionSetting(store)).toBe(true)

    await setReducedMotionSetting(store, false)
    expect(await resolveReducedMotionSetting(store)).toBe(false)
  })

  it('treats a stored value that is neither yes nor no as never chosen', async () => {
    expect(await resolveReducedMotionSetting(fakeStore({ reducedMotion: 'maybe' }))).toBeUndefined()
  })
})
