import type { PreferencesStore } from './store.js'

/**
 * X-006: whether eX-Zed draws the Spectrum border (the tape-loading stripes) around the app on a screen wider than 2560px. The key `spectrumBorder` in the desktop's
 * `preferences.json`, or the same key in the browser's `localStorage`: the Settings → Screen checkbox "Show Spectrum border" (shown only under eX-Zed) reads and writes it.
 * **On by default**, unlike the other Screen settings: the border is the Spectrum's own look and a person who has not looked for the setting should have it. Off, the
 * space around the app is plain black (Lotus's is white either way). Stored as `markOpenGroups` is (`groupLine.ts`), and read the same way, but the other way round.
 */
export const SPECTRUM_BORDER_KEY = 'spectrumBorder'

const NO = new Set(['false', 'off', 'no', '0'])

/**
 * Only a clear no turns it off. The desktop's file can hold a boolean or a number (a hand edit writes `false`), the browser's storage only text, so both are read;
 * anything else (nothing stored, an empty string, a word nobody wrote) keeps the default, and a store that cannot be read is on and never an error on the first
 * screen. Nothing is written by reading.
 */
export async function resolveSpectrumBorder(store: PreferencesStore): Promise<boolean> {
  try {
    const stored: unknown = await store.get(SPECTRUM_BORDER_KEY)
    if (stored === false || stored === 0) return false

    return !(typeof stored === 'string' && NO.has(stored.trim().toLowerCase()))
  } catch {
    return true
  }
}

/**
 * The checkbox's write: the text `true` or `false`, as the browser's storage holds it and as `resolveSpectrumBorder` reads it. A store that cannot write is a quiet
 * no-op: the setting then lasts until the app is closed, as with the other Screen settings.
 */
export async function setSpectrumBorder(store: PreferencesStore, on: boolean): Promise<void> {
  try {
    await store.set(SPECTRUM_BORDER_KEY, String(on))
  } catch {
    // Not remembering the choice is not worth breaking Settings for.
  }
}
