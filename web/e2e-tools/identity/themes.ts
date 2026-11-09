/**
 * The themes the identity tool knows. A theme is a set of skins plus the preferences that select it; the tool captures and compares every
 * (theme, skin, engine, state) on its own, so adding a theme is adding an entry here, and no state or capture code changes (Phase 48.0).
 * `seed` is written to `localStorage` before the app loads, the same keys the app's preference store reads in the browser.
 */
export interface ThemeDefinition {
  readonly skins: readonly string[]
  /** Preference keys that select the theme itself, the same for every skin of it. */
  readonly seed: Readonly<Record<string, string>>
  /** The preference the theme's skin is stored under: the tool writes the skin it is capturing here (Quantum's `skin`, eX-Zed's `exzedSkin`, Phase 49.14). */
  readonly skinKey: string
}

export const THEMES: Readonly<Record<string, ThemeDefinition>> = {
  quantum: {
    skins: ['dark-orange', 'dark-green', 'dark-blue', 'dark-violet', 'light-bone'],
    seed: {},
    skinKey: 'skin',
  },
  // Design's order, Lode first: the same six keys as `EXZED_SKINS` (identityThemes.guard.test.ts keeps the two lists equal).
  exzed: {
    skins: ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'],
    seed: { theme: 'exzed' },
    skinKey: 'exzedSkin',
  },
}
