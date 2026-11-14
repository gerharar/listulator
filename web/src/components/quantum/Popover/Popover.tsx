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
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useOverlayRegistration } from '../overlay/OverlayManagerContext.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'
import { staircaseGeometry, tailGeometry, type TailKind } from './popoverTail.js'

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
  /**
   * Where under eX-Zed it opens (the Popover card, D29): from a button in a row (an item's ✎ and ⓘ, a group's bin) `row` puts it beside the row, as the app opens it, so it never covers the rows
   * under it; from anywhere else (the header, a list's header, a field) it is below its opener. Quantum places by `side` and does not read this.
   */
  from?: 'row'
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
export function Popover({ open, anchorEl, onDismiss, onEscape, width, side = 'beside', from, label, children }: PopoverProps) {
  const id = useId()
  const arrowRef = useRef<HTMLSpanElement>(null)
  // Under eX-Zed the popover's edge is 8px from the opener (the card: the staircase tail's tip then touches it); Quantum's is 12.
  const exzed = useTheme() === 'exzed'
  const exzedBeside = exzed && from === 'row'

  const { refs, floatingStyles, placement, middlewareData, isPositioned } = useFloating({
    open,
    // eX-Zed (the Popover card, D29): below its opener, centred on it (the tail is), and above it when there is no room below; from a button in a row, beside it as Quantum does.
    placement: exzedBeside ? 'right-start' : exzed ? 'bottom' : side === 'below' ? 'bottom-start' : 'right-start',
    elements: { reference: anchorEl },
    middleware: [
      offset(exzed ? 8 : 12),
      flip({
        fallbackPlacements: exzedBeside ? ['left-start', 'right-end', 'left-end'] : exzed ? ['top'] : side === 'below' ? ['top-start'] : ['left-start', 'right-end', 'left-end'],
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
      // The staircase is 16px wide: keep it 8px clear of the card's corners when the card is shifted to stay on screen.
      arrow({ element: arrowRef, padding: exzed ? 8 : 0 }),
    ],
    whileElementsMounted: autoUpdate,
  })

  useOverlayRegistration('popover', id, open, onEscape ?? onDismiss)

  // Under eX-Zed the button that opened a popover is lit while it is open (the Popover card), by its `aria-expanded`. Most openers set it themselves; one that does not (a row's ✎, a
  // group's bin) gets it from here for as long as the popover is open, and gives it back when it closes. Quantum's buttons are as they were.
  useEffect(() => {
    if (!exzed || !open || !anchorEl || anchorEl.hasAttribute('aria-expanded')) return

    anchorEl.setAttribute('aria-expanded', 'true')

    return () => anchorEl.removeAttribute('aria-expanded')
  }, [exzed, open, anchorEl])

  if (!open) return null

  const tailKind: TailKind = placement.startsWith('left')
    ? 'right'
    : placement.startsWith('bottom')
      ? 'up'
      : placement.startsWith('top')
        ? 'down'
        : 'left'
  const tail = tailGeometry(tailKind)
  const staircase = exzed ? staircaseGeometry(tailKind) : null
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
        <span ref={arrowRef} className={tailKind === 'left' ? 'q-pop-tail' : `q-pop-tail ${tailKind}`}>
          {staircase ? (
            <svg width={staircase.width} height={staircase.height} viewBox={staircase.viewBox} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
              <path className="q-pop-tail-rim" d={staircase.rim} />
              <path className="q-pop-tail-fill" d={staircase.fill} />
            </svg>
          ) : (
            <svg width={tail.width} height={tail.height} aria-hidden="true" focusable="false">
              <path className="q-pop-tail-rim" d={tail.rim} />
              <path className="q-pop-tail-fill" d={tail.fill} />
            </svg>
          )}
        </span>
        <div className="q-pop-scroll">{children}</div>
      </div>
    </FloatingPortal>
  )
}
