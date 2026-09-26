import { Popover, type PopoverWidth } from '../Popover/Popover.js'
import { Button } from '../Button/Button.js'
import { copy } from '../../../locale/index.js'

export interface ConfirmPopoverProps {
  open: boolean
  anchorEl: HTMLElement | null
  onDismiss: () => void
  width: PopoverWidth
  /** The mono kicker on the head row's left, e.g. "Delete". */
  kicker: string
  /** The mono kicker on the head row's right, e.g. "38 items". Omitted when there's nothing to count. */
  cost?: string
  /** The question in words — `Delete "Star Wars: Main Saga"?`, never just "Delete?". */
  question: string
  /** States the cost before the buttons. */
  note: string
  onKeep: () => void
  keepLabel?: string
  onConfirm: () => void
  confirmLabel: string
  /** Delete is `danger` (red); Sort/Reset use `accent` (the Button `primary` variant). */
  danger?: boolean
}

/**
 * The destructive mode of a Popover: confirmation priced against what's
 * lost, not against the word "delete" (design-system/components/ConfirmPopover).
 * Shares Popover's own `.q-pop-head`/`.q-pop-q`/`.q-pop-note`/`.q-pop-actions`
 * classes — no CSS of its own.
 */
export function ConfirmPopover({
  open,
  anchorEl,
  onDismiss,
  width,
  kicker,
  cost,
  question,
  note,
  onKeep,
  keepLabel = copy.quantum.common.keep,
  onConfirm,
  confirmLabel,
  danger = false,
}: ConfirmPopoverProps) {
  return (
    <Popover open={open} anchorEl={anchorEl} onDismiss={onDismiss} width={width}>
      <div className="q-pop-head">
        <span className="q-kicker">{kicker}</span>
        {cost !== undefined && (
          <span className="q-kicker" style={{ letterSpacing: 0 }}>
            {cost}
          </span>
        )}
      </div>
      <span className="q-pop-q">{question}</span>
      <span className="q-pop-note">{note}</span>
      <div className="q-pop-actions">
        <Button variant="quiet" onClick={onKeep}>
          {keepLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Popover>
  )
}
