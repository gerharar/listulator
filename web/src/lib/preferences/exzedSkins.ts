/**
 * eX-Zed's six skins (design X-003). Stored and set on `<html>` by **number, never by name**, so a rename never breaks a saved setting; the names the
 * user sees (Lode, Focal, Glemt, Xen, Kui, Lotus) are labels. The order is design's: the default first, the light skin last.
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
  kui: 'exzed-1e',
  lotus: 'exzed-1l',
} as const satisfies Record<string, ExzedSkin>
