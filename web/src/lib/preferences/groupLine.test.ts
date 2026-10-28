import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { GROUP_LINE_KEY, resolveMarkOpenGroups, setMarkOpenGroups } from './groupLine.js'

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

describe('resolveMarkOpenGroups (H-022)', () => {
  it('is off when nothing is stored: today\'s glyph, no line', async () => {
    expect(await resolveMarkOpenGroups(fakeStore())).toBe(false)
  })

  it('is read from the key `markOpenGroups`', () => {
    expect(GROUP_LINE_KEY).toBe('markOpenGroups')
  })

  it.each([true, 'true', 'TRUE', ' on ', 'yes', '1', 1])('is on for %j', async (value) => {
    expect(await resolveMarkOpenGroups(fakeStore({ [GROUP_LINE_KEY]: value }))).toBe(true)
  })

  it.each([false, 'false', 'off', 'no', '0', 0, '', 'maybe', null, {}, []])('is off for %j: only a clear yes turns it on', async (value) => {
    expect(await resolveMarkOpenGroups(fakeStore({ [GROUP_LINE_KEY]: value }))).toBe(false)
  })

  it('is off, not an error, when the store cannot be read', async () => {
    const broken: PreferencesStore = {
      get: async () => {
        throw new Error('no store')
      },
      set: async () => undefined,
    }

    expect(await resolveMarkOpenGroups(broken)).toBe(false)
  })
})

describe('setMarkOpenGroups (the Settings checkbox, H-022)', () => {
  it('writes the text true or false under the key, which resolveMarkOpenGroups reads back', async () => {
    const store = fakeStore()

    await setMarkOpenGroups(store, true)
    expect(store.set).toHaveBeenLastCalledWith(GROUP_LINE_KEY, 'true')
    expect(await resolveMarkOpenGroups(store)).toBe(true)

    await setMarkOpenGroups(store, false)
    expect(store.set).toHaveBeenLastCalledWith(GROUP_LINE_KEY, 'false')
    expect(await resolveMarkOpenGroups(store)).toBe(false)
  })

  it('turns a hand-written JSON boolean into the text form, and is a quiet no-op when the store cannot write', async () => {
    const store = fakeStore({ [GROUP_LINE_KEY]: true })
    await setMarkOpenGroups(store, false)
    expect(await resolveMarkOpenGroups(store)).toBe(false)

    const broken: PreferencesStore = {
      get: async () => undefined,
      set: async () => {
        throw new Error('no store')
      },
    }
    await expect(setMarkOpenGroups(broken, true)).resolves.toBeUndefined()
  })
})

