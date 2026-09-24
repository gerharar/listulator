import './ErrorBlock.css'
import { Button } from '../Button/Button.js'

export interface ErrorBlockAction {
  label: string
  onClick: () => void
}

export interface ErrorBlockProps {
  headline: string
  explanation: string
  /** At most one — design-system/components/ErrorStrip. */
  action?: ErrorBlockAction
}

/**
 * The hard-error shape (design-system/components/ErrorStrip): no source, no
 * key, nothing found, nowhere to reach. Appears in the same slot normal
 * content would, so the page never jumps.
 */
export function ErrorBlock({ headline, explanation, action }: ErrorBlockProps) {
  return (
    <div className="q-error-block">
      <b>{headline}</b>
      <p>{explanation}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}
