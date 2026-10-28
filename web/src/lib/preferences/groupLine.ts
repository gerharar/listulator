import type { PreferencesStore } from './store.js'

/**
 * Canvas H-022: a 1px line beside the group triangle that says open or shut. Not a Settings switch (owner, 2026-10-27, "a config-file
 * option"): the key `markOpenGroups` in the desktop's `preferences.json`, or the same key in the browser's `localStorage`. Off by default,
 * and off is today's glyph exactly.
 */
export const GROUP_LINE_KEY = 'markOpenGroups'

const YES = new Set(['true', 'on', 'yes', '1'])

/**
 * Only a clear yes turns it on. The desktop's file can hold a boolean or a number (a hand edit writes `true`), the browser's storage only
 * text, so both are read; anything else, and a store that cannot be read, is off and never an error on the first screen.
 */
export async function resolveMarkOpenGroups(store: PreferencesStore): Promise<boolean> {
  try {
    const stored: unknown = await store.get(GROUP_LINE_KEY)
    if (stored === true || stored === 1) return true

    return typeof stored === 'string' && YES.has(stored.trim().toLowerCase())
  } catch {
    return false
  }
}
