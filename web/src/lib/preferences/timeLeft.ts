import type { PreferencesStore } from './store.js'

/**
 * Canvas H-024: whether My Lists shows each list's time left, in a column, and the total in its summary line. The key `showTimeLeft` in the
 * desktop's `preferences.json`, or the same key in the browser's `localStorage`: the Settings → Screen checkbox "Show time left in My Lists" reads
 * and writes it, and a hand edit still works. Off by default: the time can be estimated, partial or missing, so My Lists shows it only when the
 * pointer is on a list's progress, or when this is on. Stored as `markOpenGroups` is (`groupLine.ts`), and read the same way.
 */
export const SHOW_TIME_LEFT_KEY = 'showTimeLeft'

const YES = new Set(['true', 'on', 'yes', '1'])

/**
 * Only a clear yes turns it on. The desktop's file can hold a boolean or a number (a hand edit writes `true`), the browser's storage only text,
 * so both are read; anything else, and a store that cannot be read, is off and never an error on the first screen.
 */
export async function resolveShowTimeLeft(store: PreferencesStore): Promise<boolean> {
  try {
    const stored: unknown = await store.get(SHOW_TIME_LEFT_KEY)
    if (stored === true || stored === 1) return true

    return typeof stored === 'string' && YES.has(stored.trim().toLowerCase())
  } catch {
    return false
  }
}

/**
 * The checkbox's write: the text `true` or `false`, as the browser's storage holds it and as `resolveShowTimeLeft` reads it. A store that cannot
 * write is a quiet no-op: the setting then lasts until the app is closed, as with the other Screen settings.
 */
export async function setShowTimeLeft(store: PreferencesStore, on: boolean): Promise<void> {
  try {
    await store.set(SHOW_TIME_LEFT_KEY, String(on))
  } catch {
    // Not remembering the choice is not worth breaking Settings for.
  }
}
