import { describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from './store.js'
import { isLanguage, LANGUAGES, resolveLanguage, setLanguage } from './language.js'

function fakeStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return {
    get: vi.fn(async (key: string) => data.get(key)),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value)
    }),
  }
}

describe('resolveLanguage', () => {
  it('is English when nothing is stored — no browser detection', async () => {
    expect(await resolveLanguage(fakeStore())).toBe('en')
  })

  it('returns whatever language was stored', async () => {
    expect(await resolveLanguage(fakeStore({ language: 'ru' }))).toBe('ru')
    expect(await resolveLanguage(fakeStore({ language: 'de' }))).toBe('de')
  })

  it('falls back to English for a stored value that is not one of the three', async () => {
    expect(await resolveLanguage(fakeStore({ language: 'fr' }))).toBe('en')
  })
})

describe('setLanguage', () => {
  it('persists the given language, and a later resolveLanguage returns it', async () => {
    const store = fakeStore()

    await setLanguage(store, 'de')

    expect(await resolveLanguage(store)).toBe('de')
  })
})

describe('isLanguage', () => {
  it('recognises exactly the three shipped languages', () => {
    for (const language of LANGUAGES) expect(isLanguage(language)).toBe(true)

    expect(isLanguage('fr')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
    expect(isLanguage(null)).toBe(false)
  })
})
