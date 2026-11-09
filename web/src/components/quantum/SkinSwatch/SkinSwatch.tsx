import './SkinSwatch.css'
import type { Skin } from '../../../lib/preferences/skin.js'
import type { ExzedSkin } from '../../../lib/preferences/exzedSkins.js'

export interface SkinSwatchProps {
  /** Always its own skin, never the active one — `data-theme` on this element is what makes that true. */
  skin: Skin
  /** 16px, for the skin menu. Default is 20px, for the header's skin button. */
  small?: boolean
}

/**
 * A skin's colours as a hex cell (design-system/components/SkinSwatch):
 * an `ink3`-rimmed hexagon split diagonally, `bg` over `accent`, always
 * drawing the skin named by `skin` regardless of which one is active —
 * `data-theme` here resolves through the nested-selector form
 * `generateTokens.ts` emits for exactly this (docs/DECISIONS.md).
 *
 * Just the mark. The skin button and its 220px menu (AppHeader, 10.9) are
 * out of scope here; Settings' skin chips use the same small hex (11.5).
 */
export function SkinSwatch({ skin, small = false }: SkinSwatchProps) {
  return <span className={small ? 'q-hex sm' : 'q-hex'} data-theme={skin} aria-hidden="true" />
}

export interface ExzedSkinSwatchProps {
  /** Always its own skin, never the active one: `data-theme` on this element gives it that skin's `--zx-` roles (exzed-tokens.css). */
  skin: ExzedSkin
}

/**
 * An eX-Zed skin's half-bucket swatch (design X-003, `.zx-swatch`): a 16px square, its top half the skin's `paper` and its bottom half the skin's
 * colour, in a 2px rim of the text colour (so it reads on a lit chip too). Like the hexagon it draws the skin named by `skin`, whichever is active.
 */
export function ExzedSkinSwatch({ skin }: ExzedSkinSwatchProps) {
  return <span className="q-zx-swatch" data-theme={skin} aria-hidden="true" />
}
