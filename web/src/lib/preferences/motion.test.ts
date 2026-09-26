import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { resolveReducedMotionSetting, setReducedMotionSetting } from './motion.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

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
