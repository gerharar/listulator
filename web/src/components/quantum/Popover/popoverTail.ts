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

export interface StaircaseGeometry {
  /** The tail's box in CSS px: 16 x 10 (10 x 16 on a side), one eX-Zed pixel being 2px. */
  width: number
  height: number
  /** The drawing's own grid: 8 x 5 cells (5 x 8 on a side). */
  viewBox: string
  /** The outline cells, in the border's colour. */
  rim: string
  /** The cells inside it, in the card's: they cover the card's own border under the tail, so the base breaks it into one outline. */
  fill: string
}

/** The Popover card's tail, pointing up: [x, y, width, height] cells on an 8 x 5 grid. The last row is the card's border row. */
const RIM_UP: readonly (readonly [number, number, number, number])[] = [[3, 0, 2, 1], [2, 1, 1, 1], [5, 1, 1, 1], [1, 2, 1, 1], [6, 2, 1, 1], [0, 3, 1, 2], [7, 3, 1, 2]]
const FILL_UP: readonly (readonly [number, number, number, number])[] = [[3, 1, 2, 1], [2, 2, 4, 1], [1, 3, 6, 2]]

/**
 * The eX-Zed tail (design's Popover card): an 8 x 5 hollow staircase at 2px, 16 x 10, whatever the side: down mirrors the rows, left and right turn the grid a quarter (the tip toward the
 * anchor). Cells are drawn as `M x y h w v h H x z` rectangles so the drawing stays on the pixel grid.
 */
export function staircaseGeometry(kind: TailKind): StaircaseGeometry {
  const place = ([x, y, w, h]: readonly [number, number, number, number]): [number, number, number, number] => {
    switch (kind) {
      case 'up':
        return [x, y, w, h]
      case 'down':
        return [x, 5 - y - h, w, h]
      case 'left':
        return [y, x, h, w]
      case 'right':
        return [5 - y - h, x, h, w]
    }
  }
  const draw = (cells: readonly (readonly [number, number, number, number])[]) =>
    cells
      .map(place)
      .map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}H${x}z`)
      .join('')
  const across = kind === 'up' || kind === 'down'

  return {
    width: across ? 16 : 10,
    height: across ? 10 : 16,
    viewBox: across ? '0 0 8 5' : '0 0 5 8',
    rim: draw(RIM_UP),
    fill: draw(FILL_UP),
  }
}
