/** Which way the tail points: `left` is on the card's left edge (pointing left), `up` on its top edge, and so on. */
export type TailKind = 'left' | 'right' | 'up' | 'down'

export interface TailGeometry {
  /** The tail's box, in CSS px: 9px deep, 18px along the card's edge. */
  width: number
  height: number
  /** The `--rule` triangle: the outline. */
  rim: string
  /** The `--card` triangle: the rim's shape moved 1px toward the card, so the rim shows 1px along the two slanted sides. */
  fill: string
}

/**
 * One drawing for both triangles (they were two CSS triangles whose positions snapped to device pixels differently, which on a 125% display
 * left one slanted side without its rim and the other with a double one). Both paths share the SVG's coordinates, so they scale and snap
 * together. The fill reaches 1px past the box on the card's side: that is what covers the card's own border under the tail.
 */
export function tailGeometry(kind: TailKind): TailGeometry {
  switch (kind) {
    case 'left':
      return { width: 9, height: 18, rim: 'M0 9 L9 0 L9 18 Z', fill: 'M1 9 L10 0 L10 18 Z' }
    case 'right':
      return { width: 9, height: 18, rim: 'M9 9 L0 0 L0 18 Z', fill: 'M8 9 L-1 0 L-1 18 Z' }
    case 'up':
      return { width: 18, height: 9, rim: 'M9 0 L0 9 L18 9 Z', fill: 'M9 1 L0 10 L18 10 Z' }
    case 'down':
      return { width: 18, height: 9, rim: 'M9 9 L0 0 L18 0 Z', fill: 'M9 8 L0 -1 L18 -1 Z' }
  }
}
