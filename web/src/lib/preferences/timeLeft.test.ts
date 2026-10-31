import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { SHOW_TIME_LEFT_KEY, resolveShowTimeLeft, setShowTimeLeft } from './timeLeft.js'

/** The desktop's file can hold any JSON value under the key (an owner editing it by hand writes a boolean), the web's `localStorage` only text. */
function fakeStore(initial: Record<string, unknown> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key) as string | undefined),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveShowTimeLeft (H-024: Settings → Screen → Show time left in My Lists)', () => {
  it('is off when nothing is stored: My Lists shows no time, it appears on hover', async () => {
    expect(await resolveShowTimeLeft(fakeStore())).toBe(false)
  })

  it('is read from the key `showTimeLeft`', () => {
    expect(SHOW_TIME_LEFT_KEY).toBe('showTimeLeft')
  })

  it.each([true, 'true', 'TRUE', ' on ', 'yes', '1', 1])('is on for %j', async (value) => {
    expect(await resolveShowTimeLeft(fakeStore({ [SHOW_TIME_LEFT_KEY]: value }))).toBe(true)
  })

  it.each([false, 'false', 'off', 'no', '0', 0, '', 'maybe', null, {}, []])('is off for %j: only a clear yes turns it on', async (value) => {
    expect(await resolveShowTimeLeft(fakeStore({ [SHOW_TIME_LEFT_KEY]: value }))).toBe(false)
  })

  it('is off, not an error, when the store cannot be read', async () => {
    const broken: PreferencesStore = {
      get: async () => {
        throw new Error('no store')
      },
      set: async () => undefined,
    }

    expect(await resolveShowTimeLeft(broken)).toBe(false)
  })
})

describe('setShowTimeLeft (the Settings checkbox)', () => {
  it('writes the text true or false under the key, which resolveShowTimeLeft reads back', async () => {
    const store = fakeStore()

    await setShowTimeLeft(store, true)
    expect(store.set).toHaveBeenLastCalledWith(SHOW_TIME_LEFT_KEY, 'true')
    expect(await resolveShowTimeLeft(store)).toBe(true)

    await setShowTimeLeft(store, false)
    expect(store.set).toHaveBeenLastCalledWith(SHOW_TIME_LEFT_KEY, 'false')
    expect(await resolveShowTimeLeft(store)).toBe(false)
  })

  it('turns a hand-written JSON boolean into the text form, and is a quiet no-op when the store cannot write', async () => {
    const store = fakeStore({ [SHOW_TIME_LEFT_KEY]: true })
    await setShowTimeLeft(store, false)
    expect(await resolveShowTimeLeft(store)).toBe(false)

    const broken: PreferencesStore = {
      get: async () => undefined,
      set: async () => {
        throw new Error('no store')
      },
    }
    await expect(setShowTimeLeft(broken, true)).resolves.toBeUndefined()
  })
})
