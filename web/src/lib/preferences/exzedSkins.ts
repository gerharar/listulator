/**
 * eX-Zed's six skins (design X-003). Stored and set on `<html>` by **number, never by name**, so a rename never breaks a saved setting; the names the
 * user sees (Lode, Focal, Glemt, Xen, Ikigai, Lotus) are labels. The order is design's: the default first, the light skin last.
 */
export const EXZED_SKINS = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'] as const

export type ExzedSkin = (typeof EXZED_SKINS)[number]

/** The skin a fresh eX-Zed starts in, and what an unknown stored key falls back to. */
export const DEFAULT_EXZED_SKIN: ExzedSkin = 'exzed-1d'

/** Design's ids in its `tokens.json` (`color.themes`) against our keys: the one place the two meet, shared by the token generator and the preference code. */
export const EXZED_SKIN_OF_DESIGN_ID = {
  lode: 'exzed-1d',
  focal: 'exzed-1a',
  glemt: 'exzed-1b',
  xen: 'exzed-1c',
  // Design's id for this skin was `kui` until it renamed the skin Ikigai (2026-11-11): both are accepted, so the token generator takes whichever its `tokens.json` has.
  kui: 'exzed-1e',
  ikigai: 'exzed-1e',
  lotus: 'exzed-1l',
} as const satisfies Record<string, ExzedSkin>

/**
 * The names the user sees (design X-003), without the number. Not translated: they are names, like Quantum's skins in `copy.quantum.skin.labels` are not
 * localised word for word either, and design's boards show them as written.
 */
export const EXZED_SKIN_NAMES = {
  'exzed-1d': 'Lode',
  'exzed-1a': 'Focal',
  'exzed-1b': 'Glemt',
  'exzed-1c': 'Xen',
  'exzed-1e': 'Ikigai',
  'exzed-1l': 'Lotus',
} as const satisfies Record<ExzedSkin, string>
