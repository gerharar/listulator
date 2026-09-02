const CELLS = 12

export interface ProgressProps {
  percent: number
  large?: boolean
  label: string
}

/**
 * A blocky segmented bar — the nod to the file-manager lineage
 * (docs/design/README.md). Cells are elements rather than █░ characters
 * because Inter has no block glyphs and would fall back inconsistently.
 */
export function Progress({ percent, large = false, label }: ProgressProps) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * CELLS)

  return (
    <div
      className={large ? 'progress progress--large' : 'progress'}
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: CELLS }, (_, index) => (
        <span
          key={index}
          className={index < filled ? 'progress__cell progress__cell--filled' : 'progress__cell'}
        />
      ))}
    </div>
  )
}
