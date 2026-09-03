/** Names live in the locale; this is the set of themes and their order. */
export const THEME_KEYS = ['dn', 'dark', 'brown', 'orange', 'bone', 'white'] as const

export type ThemeKey = (typeof THEME_KEYS)[number]

const STORAGE_KEY = 'duldulator:theme'

export function isThemeKey(value: unknown): value is ThemeKey {
  return THEME_KEYS.some((key) => key === value)
}

/**
 * Remembered choice wins; otherwise follow the OS. Storage can throw in a
 * private window or with site data blocked, so a failure just means "no
 * preference saved" rather than a broken page.
 */
export function resolveInitialTheme(
  storage: Pick<Storage, 'getItem'> | undefined,
  prefersDark: boolean,
): ThemeKey {
  try {
    const stored = storage?.getItem(STORAGE_KEY)
    if (isThemeKey(stored)) return stored
  } catch {
    // ignore
  }

  return prefersDark ? 'dn' : 'bone'
}

export function persistTheme(storage: Pick<Storage, 'setItem'> | undefined, theme: ThemeKey): void {
  try {
    storage?.setItem(STORAGE_KEY, theme)
  } catch {
    // Not being able to remember the choice is not worth breaking anything for.
  }
}
