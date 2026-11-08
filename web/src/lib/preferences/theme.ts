import type { PreferencesStore } from './store.js'

/**
 * The app's themes: Quantum, and eX-Zed (the ZX Spectrum look, Phase 48). A theme is the drawing; a skin (`skin.ts`) is a colour set inside it.
 * Only `resolveTheme` exists: there is no control and nothing writes the key until X-003 adds the choice, so today a stored `exzed` can only
 * come from a test or from someone editing their own preferences.
 */
export const THEMES = ['quantum', 'exzed'] as const

export type Theme = (typeof THEMES)[number]

/** Not `listulator:theme`: that was the old six-theme system's key and is never read. */
const THEME_KEY = 'theme'

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}

/** Anything but a known theme (nothing stored, an old or mistyped value, a store that cannot be read) is Quantum: the app must always start. */
export async function resolveTheme(store: PreferencesStore): Promise<Theme> {
  try {
    const stored = await store.get(THEME_KEY)
    return isTheme(stored) ? stored : 'quantum'
  } catch {
    return 'quantum'
  }
}
