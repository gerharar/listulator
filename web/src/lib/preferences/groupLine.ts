import type { PreferencesStore } from './store.js'

/**
 * Canvas H-022: a 1px line beside the group triangle that says open or shut. The key `markOpenGroups` in the desktop's `preferences.json`,
 * or the same key in the browser's `localStorage`: the Settings → Screen checkbox "Mark open and closed groups" reads and writes it (owner,
 * 2026-10-28, through design; before that it was a hand-edited key only, 2026-10-27), and a hand edit still works. Off by default, and off
 * is today's glyph exactly.
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

/**
 * The checkbox's write: the text `true` or `false`, as the browser's storage holds it and as `resolveMarkOpenGroups` reads it (a JSON boolean
 * written by hand into `preferences.json` is read as well, and replaced by the text on the first change). A store that cannot write is a quiet
 * no-op: the setting then lasts until the app is closed, as with the other Screen settings.
 */
export async function setMarkOpenGroups(store: PreferencesStore, on: boolean): Promise<void> {
  try {
    await store.set(GROUP_LINE_KEY, String(on))
  } catch {
    // Not remembering the choice is not worth breaking Settings for.
  }
}

