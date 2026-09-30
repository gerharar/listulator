import './Popover.css'
import {
  arrow,
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
} from '@floating-ui/react'
import { useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useOverlayRegistration } from '../overlay/OverlayManagerContext.js'

/**
 * The six widths the design system names: skin menu, list actions, API key/order, list edit/item info, reset, item edit;
 * and `fit`, content-wide from 240px up to the window (the platform card: a platform name stays on one line).
 */
export type PopoverWidth = 220 | 240 | 300 | 320 | 340 | 360 | 'fit'

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
  /** Esc, when it should mean something other than click-away (an edit popover cancels). */
  onEscape?: () => void
  width: PopoverWidth
  /**
   * `beside` (default): right of the anchor, flipping left, the tail on its side.
   * `below`: under the anchor from its left edge, flipping above, the tail on top —
   * for an anchor whose width changes while the popover is open (U4's facet
   * dropdown names its picks), so the popover does not move along with it.
   */
  side?: 'beside' | 'below'
  /** The dialog's accessible name, when its content does not give one. */
  label?: string
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
export function Popover({ open, anchorEl, onDismiss, onEscape, width, side = 'beside', label, children }: PopoverProps) {
  const id = useId()
  const arrowRef = useRef<HTMLSpanElement>(null)

  const { refs, floatingStyles, placement, middlewareData, isPositioned } = useFloating({
    open,
    placement: side === 'below' ? 'bottom-start' : 'right-start',
    elements: { reference: anchorEl },
    middleware: [
      offset(12),
      flip({
        fallbackPlacements: side === 'below' ? ['top-start'] : ['left-start', 'right-end', 'left-end'],
      }),
      shift({ padding: 8 }),
      // Taller than the room left (a short window, a long picker): stop at the screen's edge and
      // scroll the content inside, rather than run off the top or bottom (11.3). Only then: a card
      // that fits keeps visible overflow, so a dropdown inside it can reach past its edge.
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          const card = elements.floating
          // Measured uncapped: a dropdown open inside the card (the Group list) hangs below its box and
          // must not count, or a card that fits would start clipping its own suggestions.
          card.style.maxHeight = ''
          if (card.getBoundingClientRect().height > availableHeight) {
            card.style.maxHeight = `${Math.max(availableHeight, 160)}px`
            card.dataset['capped'] = ''
          } else {
            delete card.dataset['capped']
          }
        },
      }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useOverlayRegistration('popover', id, open, onEscape ?? onDismiss)

  if (!open) return null

  const tailClass = placement.startsWith('left')
    ? 'q-pop-tail right'
    : placement.startsWith('bottom')
      ? 'q-pop-tail up'
      : placement.startsWith('top')
        ? 'q-pop-tail down'
        : 'q-pop-tail'
  const tailY = middlewareData.arrow?.y ?? 0
  const tailX = middlewareData.arrow?.x ?? 0

  return (
    <FloatingPortal>
      <div className="q-catcher" onClick={onDismiss} />
      <div
        ref={refs.setFloating}
        // Until floating-ui has placed it the card would sit at the top-left corner: keep it unseen.
        style={
          {
            ...floatingStyles,
            opacity: isPositioned ? 1 : 0,
            '--tail-y': `${tailY}px`,
            '--tail-x': `${tailX}px`,
          } as CSSProperties
        }
        className={`q-pop w${width}`}
        role="dialog"
        aria-label={label}
      >
        <span ref={arrowRef} className={tailClass} />
        <div className="q-pop-scroll">{children}</div>
      </div>
    </FloatingPortal>
  )
}
