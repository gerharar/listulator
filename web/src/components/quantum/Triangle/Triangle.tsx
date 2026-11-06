import './Triangle.css'

/**
 * The one triangle (canvas H-027). Every disclosure, picker and sort mark in the app is this filled shape, drawn, never a text glyph: our fonts
 * have no ▼ ▶ ▲, so each OS took them from a different system font and they came out different sizes, hollow on Windows, and off the text's middle.
 * Three sizes by role, `width` x `height` pointing down (the ink); `box` is the drawing's own size.
 *
 * The row fold's box is 8 x 8 with the 8 x 7 ink at its top, so a 90 degree turn about the box's centre lands on whole pixels (an 8 x 7 box turned
 * would land half a pixel off both ways). The 14 x 12 turns in the group head's 20px box as H-022 built it, and the 6 x 5 turns 180 degrees in its own.
 * The widths are even so the point lands on a whole pixel.
 */
export type TriangleKind = 'section' | 'row' | 'picker'

/** Down is the drawing; right is shut (a quarter turn to the left), up is a sort ascending (a half turn). */
export type TriangleDirection = 'down' | 'right' | 'up'

interface TriangleSize {
  /** The ink pointing down. */
  width: number
  height: number
  /** The drawing's own size: the ink, plus the row fold's spare pixel below it. */
  box: { width: number; height: number }
}

export const TRIANGLE_SIZES: Record<TriangleKind, TriangleSize> = {
  section: { width: 14, height: 12, box: { width: 14, height: 12 } },
  row: { width: 8, height: 7, box: { width: 8, height: 8 } },
  picker: { width: 6, height: 5, box: { width: 6, height: 5 } },
}

const TURN: Record<TriangleDirection, string | undefined> = {
  down: undefined,
  right: 'rotate(-90deg)',
  up: 'rotate(180deg)',
}

export interface TriangleProps {
  kind: TriangleKind
  direction?: TriangleDirection
  className?: string
}

/**
 * Hidden from assistive technology: the control keeps its own name and `aria-expanded` / `aria-sort`. Open and shut are this one element turned
 * by `transform`, so a call site's own `transition: transform` animates it; the colour is the text colour (`fill: currentColor`).
 */
export function Triangle({ kind, direction = 'down', className }: TriangleProps) {
  const { width, height, box } = TRIANGLE_SIZES[kind]

  return (
    <svg
      className={className ? `q-triangle ${className}` : 'q-triangle'}
      width={box.width}
      height={box.height}
      viewBox={`0 0 ${box.width} ${box.height}`}
      style={{ transform: TURN[direction] }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={`M0 0H${width}L${width / 2} ${height}Z`} fill="currentColor" />
    </svg>
  )
}
