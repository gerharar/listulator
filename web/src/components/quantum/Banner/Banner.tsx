import './Banner.css'
import type { ReactNode } from 'react'
import { Button } from '../Button/Button.js'

export interface BannerProps {
  /** The one sentence — a bold name inside 400 prose. Composed by the caller: Home links several updated lists, a list links one. */
  children: ReactNode
  onDismiss: () => void
  /** "Dismiss" on Home; a list's own banner uses a different action label entirely (design-system/components/Banner) — not built until that screen needs it. */
  dismissLabel: string
  /** Ghost on Home ("Dismiss"); a list's own banner offers Mark all seen as a secondary button. */
  actionVariant?: 'ghost' | 'secondary'
  /** A second, primary-side action beside Dismiss (an update band: Update List). */
  action?: { label: string; onClick: () => void; busy?: boolean }
}

/** A full-width line under a header, for news about the content — optional, dismissible, never blocking (design-system/components/Banner). */
export function Banner({ children, onDismiss, dismissLabel, actionVariant = 'ghost', action }: BannerProps) {
  return (
    <div className="q-banner">
      <span>{children}</span>
      <div className="q-banner-actions">
        {action && (
          <Button variant="secondary" size="sm" onClick={action.onClick} disabled={action.busy === true}>
            {action.label}
          </Button>
        )}
        <Button variant={actionVariant} size="sm" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
    </div>
  )
}
