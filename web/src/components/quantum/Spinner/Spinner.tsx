import './Spinner.css'

export interface SpinnerProps {
  /** What is being waited on, for assistive tech — the ring itself says nothing. */
  label: string
}

/**
 * The only progress indication this phase (Q12): no determinate bar and no
 * streaming. A ring that turns (design-system `.q-spinner`), in `ink` on
 * `line`; one of the few round shapes the design allows.
 */
export function Spinner({ label }: SpinnerProps) {
  return <span className="q-spinner" role="status" aria-label={label} />
}
