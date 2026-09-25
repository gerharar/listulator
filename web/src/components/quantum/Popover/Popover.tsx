import './Popover.css'
import {
  arrow,
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import { useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useOverlayRegistration } from '../overlay/OverlayManagerContext.js'

/** The six widths the design system names: skin menu, platforms/list actions, API key/order, list edit/item info, reset, item edit. */
export type PopoverWidth = 220 | 240 | 300 | 320 | 340 | 360

export interface PopoverProps {
  open: boolean
  /** The element this popover is anchored to — a `null` while the trigger hasn't mounted yet is fine. */
  anchorEl: HTMLElement | null
  /**
   * Fired on click-away or Esc. What that *means* is the caller's call: a
   * plain popover just closes, an edit popover commits (with an Undo
   * toast) — "the buttons are the contract; the click-away is the safety
   * net" (design-system/components/Popover).
   */
  onDismiss: () => void
  width: PopoverWidth
  children: ReactNode
}

/**
 * The single object behind every per-object action: a tail-anchored card,
 * flipped side-to-side and shifted vertically by `@floating-ui/react`
 * rather than hand-rolled maths (design-system/components/Popover).
 * Registers with the shared OverlayManager so only one popover is ever
 * open, and so the Esc ladder can find it.
 *
 * **Modes** (rename/export/delete swapping the body) are the caller's
 * concern — this component only re-renders whatever `children` it's given
 * for a stable `open`/`anchorEl`, so the tail never moves between them.
 */
export function Popover({ open, anchorEl, onDismiss, width, children }: PopoverProps) {
  const id = useId()
  const arrowRef = useRef<HTMLSpanElement>(null)

  const { refs, floatingStyles, placement, middlewareData } = useFloating({
    open,
    placement: 'right-start',
    elements: { reference: anchorEl },
    middleware: [
      offset(12),
      flip({ fallbackPlacements: ['left-start', 'right-end', 'left-end'] }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useOverlayRegistration('popover', id, open, onDismiss)

  if (!open) return null

  const tailOnRight = placement.startsWith('left')
  const tailY = middlewareData.arrow?.y ?? 0

  return (
    <FloatingPortal>
      <div className="q-catcher" onClick={onDismiss} />
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, '--tail-y': `${tailY}px` } as CSSProperties}
        className={`q-pop w${width}`}
        role="dialog"
      >
        <span ref={arrowRef} className={tailOnRight ? 'q-pop-tail right' : 'q-pop-tail'} />
        {children}
      </div>
    </FloatingPortal>
  )
}
