import './SkinSwatch.css'
import type { Skin } from '../../../lib/preferences/skin.js'

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
 * Just the mark. The skin button, its 220px menu (AppHeader, 10.9) and
 * Settings' square `.q-swatch-sq` variant are out of scope here.
 */
export function SkinSwatch({ skin, small = false }: SkinSwatchProps) {
  return <span className={small ? 'q-hex sm' : 'q-hex'} data-theme={skin} aria-hidden="true" />
}
