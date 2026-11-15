import './ErrorBlock.css'
import { Button } from '../Button/Button.js'

export interface ErrorBlockAction {
  label: string
  onClick: () => void
  /** For an action whose destination does not exist yet (e.g. Settings, until 10.31). */
  disabled?: boolean
  title?: string
}

export interface ErrorBlockProps {
  headline: string
  /** Left out (or empty) for a headline that says it all: no paragraph is drawn, so no margin is left under it. */
  explanation?: string
  /** A second paragraph under the explanation, in the same type (the failed start's pointer to the backups folder, 52.3). Left out, none is drawn. */
  note?: string
  /** At most one — design-system/components/ErrorStrip. */
  action?: ErrorBlockAction
}

/**
 * The hard-error shape (design-system/components/ErrorStrip): no source, no
 * key, nothing found, nowhere to reach. Appears in the same slot normal
 * content would, so the page never jumps.
 */
export function ErrorBlock({ headline, explanation, note, action }: ErrorBlockProps) {
  return (
    <div className="q-error-block">
      <b>{headline}</b>
      {explanation && <p>{explanation}</p>}
      {note && <p>{note}</p>}
      {action && (
        <Button onClick={action.onClick} disabled={action.disabled} title={action.title}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
