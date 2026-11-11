import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { SPECTRUM_BORDER_KEY, resolveSpectrumBorder, setSpectrumBorder } from './spectrumBorder.js'

/** The desktop's file can hold any JSON value under the key (a hand edit writes a boolean), the web's `localStorage` only text. */
function fakeStore(initial: Record<string, unknown> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key) as string | undefined),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveSpectrumBorder (X-006: Settings → Screen → Show Spectrum border, eX-Zed only)', () => {
  it('is on when nothing is stored: the border is shown by default, and nothing is written for it', async () => {
    const store = fakeStore()

    expect(await resolveSpectrumBorder(store)).toBe(true)
    expect(store.set).not.toHaveBeenCalled()
  })

  it('is read from the key `spectrumBorder`', () => {
    expect(SPECTRUM_BORDER_KEY).toBe('spectrumBorder')
  })

  it.each([false, 'false', 'FALSE', ' off ', 'no', '0', 0])('is off for %j: only a clear no turns it off', async (value) => {
    expect(await resolveSpectrumBorder(fakeStore({ [SPECTRUM_BORDER_KEY]: value }))).toBe(false)
  })

  it.each([true, 'true', 'on', 'yes', '1', 1, '', 'maybe', null, {}, [], 'banana'])('is on for %j: anything that is not a clear no keeps the default', async (value) => {
    expect(await resolveSpectrumBorder(fakeStore({ [SPECTRUM_BORDER_KEY]: value }))).toBe(true)
  })

  it('is on, not an error, and writes nothing, when the store cannot be read', async () => {
    const set = vi.fn(async () => undefined)
    const broken: PreferencesStore = {
      get: async () => {
        throw new Error('no store')
      },
      set,
    }

    expect(await resolveSpectrumBorder(broken)).toBe(true)
    expect(set).not.toHaveBeenCalled()
  })
})

describe('setSpectrumBorder (the Settings checkbox)', () => {
  it('writes the text true or false under the key, which resolveSpectrumBorder reads back', async () => {
    const store = fakeStore()

    await setSpectrumBorder(store, false)
    expect(store.set).toHaveBeenLastCalledWith(SPECTRUM_BORDER_KEY, 'false')
    expect(await resolveSpectrumBorder(store)).toBe(false)

    await setSpectrumBorder(store, true)
    expect(store.set).toHaveBeenLastCalledWith(SPECTRUM_BORDER_KEY, 'true')
    expect(await resolveSpectrumBorder(store)).toBe(true)
  })

  it('is a quiet no-op when the store cannot write: the choice then lasts until the app is closed', async () => {
    const broken: PreferencesStore = {
      get: async () => undefined,
      set: async () => {
        throw new Error('read only')
      },
    }

    await expect(setSpectrumBorder(broken, false)).resolves.toBeUndefined()
  })
})
