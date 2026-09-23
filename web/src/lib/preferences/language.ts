import type { PreferencesStore } from './store.js'

/** All three ship at once (Q9) — there's no "hide until translated" gate. */
export const LANGUAGES = ['en', 'ru', 'de'] as const

export type Language = (typeof LANGUAGES)[number]

const LANGUAGE_KEY = 'language'

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((language) => language === value)
}

/**
 * No stored preference means English — never `navigator.language` or any
 * other browser-detection. Q9 doesn't ask for it, and the picker (10.30) is
 * how a language actually gets chosen.
 */
export async function resolveLanguage(store: PreferencesStore): Promise<Language> {
  const stored = await store.get(LANGUAGE_KEY)
  return isLanguage(stored) ? stored : 'en'
}

export async function setLanguage(store: PreferencesStore, language: Language): Promise<void> {
  await store.set(LANGUAGE_KEY, language)
}
