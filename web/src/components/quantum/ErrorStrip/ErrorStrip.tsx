import './ErrorStrip.css'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'

export interface ErrorStripProps {
  message: string
  onRetry: () => void
  onDismiss: () => void
}

/**
 * The recoverable-error shape (design-system/components/ErrorStrip): a
 * timeout or a rate limit. One line on `fill`, no red, with Retry and
 * Dismiss. Sits in the same slot as `ErrorBlock` so the form never jumps.
 */
export function ErrorStrip({ message, onRetry, onDismiss }: ErrorStripProps) {
  return (
    <div className="q-error-strip" role="alert">
      <span>{message}</span>
      <Button size="sm" onClick={onRetry}>
        {copy.quantum.search.retry}
      </Button>
      <Button size="sm" variant="quiet" onClick={onDismiss}>
        {copy.quantum.search.dismiss}
      </Button>
    </div>
  )
}
