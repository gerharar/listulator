import './Spinner.css'
import { useTheme } from '../DocumentTheme/ThemeContext.js'

export interface SpinnerProps {
  /** What is being waited on, for assistive tech — the ring itself says nothing. */
  label: string
  /** Beside a sentence that already says it (the waiting toast): hidden from assistive tech, so it is not said twice. */
  decorative?: boolean
}

/** eX-Zed's eight cells (design's Spinner card), clockwise from the top, as `[x, y]` in a 12-unit box. */
const CELLS = [
  [5, 0],
  [8, 2],
  [10, 5],
  [8, 8],
  [5, 10],
  [2, 8],
  [0, 5],
  [2, 2],
] as const

/**
 * The only progress indication this phase (Q12): no determinate bar and no
 * streaming. A ring that turns (design-system `.q-spinner`), in `ink` on
 * `line`; one of the few round shapes the design allows. Under eX-Zed it is eight square cells
 * on a ring instead, and the stylesheet moves a bright head round them a cell at a time.
 */
export function Spinner({ label, decorative = false }: SpinnerProps) {
  const exzed = useTheme() === 'exzed'

  return (
    <span className="q-spinner" {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })}>
      {exzed && (
        <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
          {CELLS.map(([x, y]) => (
            <rect key={`${x},${y}`} x={x} y={y} width={2} height={2} />
          ))}
        </svg>
      )}
    </span>
  )
}
