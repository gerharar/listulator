import type { PreferencesStore } from './store.js'

/**
 * The app's themes: Quantum, and eX-Zed (the ZX Spectrum look, Phase 48). A theme is the drawing; a skin (`skin.ts`) is a colour set inside it.
 * `setTheme` writes the choice (X-003); until Settings offers it (49.8) a stored `exzed` can only come from a test or from someone editing their own
 * preferences.
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

export async function setTheme(store: PreferencesStore, theme: Theme): Promise<void> {
  await store.set(THEME_KEY, theme)
}

/**
 * The theme the app is drawn in: the stored one where the device has a fine pointer that can hover, Quantum on a touch-only device (design, answer 8: eX-Zed is a
 * desktop theme). What is stored is only read here and never rewritten, because the preference may be shared with a desktop that does have the pointer.
 */
export function effectiveTheme(stored: Theme, finePointer: boolean): Theme {
  return finePointer ? stored : 'quantum'
}
