import type { Theme } from './theme.js'

/**
 * The skin the page carries as `data-theme`: the active theme’s own, never the other’s. Quantum and eX-Zed each keep a skin (`skin`,
 * `exzedSkin`), and an `exzed-…` key on a Quantum page, or a Quantum key on an eX-Zed one, would match none of the other theme’s token blocks.
 */
export function activeSkin<Q extends string, E extends string>(theme: Theme, skins: { quantum: Q; exzed: E }): Q | E {
  return theme === 'exzed' ? skins.exzed : skins.quantum
}
