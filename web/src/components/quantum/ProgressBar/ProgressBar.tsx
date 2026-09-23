import './ProgressBar.css'
import { useEffect, useState } from 'react'
import { copy } from '../../../locale/index.js'

export interface ProgressBarProps {
  /** A present-participle sentence, e.g. "Importing Doctor Who — Classic Run…". */
  label: string
  percent: number
}

/**
 * A determinate bar for work over ~10 seconds (design-system/components/ProgressBar).
 * Import only — never use it for decoration.
 */
export function ProgressBar({ label, percent }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent))

  return (
    <div className="q-pbar">
      <div className="q-pbar-head">
        <span>{label}</span>
        <span className="q-pbar-pct">{Math.round(clamped)}%</span>
      </div>
      <div className="q-pbar-track">
        <i style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

const SPINNER_DELAY_MS = 400

export interface SpinnerProps {
  label?: string
}

/**
 * For work under ~10 seconds. Never shown before 400ms — anything faster
 * doesn't need a progress signal, and a spinner that flashes on and off
 * reads as more broken than no spinner at all.
 */
export function Spinner({ label = copy.app.loading }: SpinnerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SPINNER_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null
  return <span className="q-spinner" role="status" aria-label={label} />
}
