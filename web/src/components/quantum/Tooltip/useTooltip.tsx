import './Tooltip.css'
import { useCallback, useEffect, useId, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react'
import { autoUpdate, flip, FloatingPortal, offset, shift, useFloating, type Placement } from '@floating-ui/react'

/** Half a second of a mouse hover (owner's ruling, 11.19; the native wait is several seconds): long enough not to flicker while passing over, far quicker than native. */
export const TOOLTIP_DELAY_MS = 500

interface Active {
  /** What the tooltip is drawn against, and what it describes. */
  anchor: HTMLElement
  /** The element the pointer or the focus is on, which ends the tooltip when it leaves: the anchor itself, unless `anchorTo` says otherwise. */
  source: HTMLElement
  /** A mouse waits `TOOLTIP_DELAY_MS`; keyboard focus shows it at once. */
  by: 'hover' | 'focus'
}

/**
 * Only one tooltip shows at a time. A pointer entering nested elements enters the outer one first,
 * so the last to activate is the innermost, and it takes over (as a native title would: the inner wins).
 */
let closeCurrent: (() => void) | null = null

export interface TooltipHandle {
  /** Merges the tooltip's handlers into the element's own props (theirs still run). */
  props: <P extends { onPointerEnter?: unknown; onFocus?: unknown }>(own: P) => P
  /** Render next to the element; nothing until the pointer or focus is on it. */
  node: ReactNode
}

/**
 * The app's own hover text, in place of the native `title` (11.19): after `TOOLTIP_DELAY_MS` of a
 * mouse hover, or at once for keyboard focus; gone on leave, blur, a press or Esc. Never for a touch.
 * It works on a disabled element too, whose title is what says why it is disabled.
 *
 * Cheap to have on every button of a long list: an idle button holds one `useState` and two handlers.
 * The positioning machinery exists only for the one tooltip that is showing.
 */
export interface TooltipOptions {
  whenClipped?: boolean
  /** Where it sits against its anchor; above and centred unless said (`top-end` lines the right edges up). */
  placement?: Placement
  /** Mono type, for a tooltip that is a number or a time (H-024). */
  mono?: boolean
  /**
   * Draw the tooltip against another element than the one the pointer or focus is on: My Lists' row is the one button, but its time
   * hangs off the bar, percentage and count (H-024). The tooltip still ends when the pointer or focus leaves the element it started on.
   */
  anchorTo?: () => HTMLElement | null
}

export function useTooltip(text: string | undefined, options: TooltipOptions = {}): TooltipHandle {
  const [active, setActive] = useState<Active | null>(null)
  const enabled = text !== undefined && text !== ''
  const close = useCallback(() => {
    if (closeCurrent === close) closeCurrent = null
    setActive(null)
  }, [])
  const activate = (next: Active) => {
    if (closeCurrent !== close) closeCurrent?.()
    closeCurrent = close
    setActive(next)
  }

  return {
    props: (own) => ({
      ...own,
      onPointerEnter: (event: PointerEvent<HTMLElement>) => {
        ;(own.onPointerEnter as ((e: PointerEvent<HTMLElement>) => void) | undefined)?.(event)
        // A touch also sends a pointer-enter; it must not raise a tooltip nobody can dismiss.
        if (enabled && event.pointerType !== 'touch' && showsFor(event.currentTarget, options.whenClipped)) {
          activate({ anchor: options.anchorTo?.() ?? event.currentTarget, source: event.currentTarget, by: 'hover' })
        }
      },
      onFocus: (event: FocusEvent<HTMLElement>) => {
        ;(own.onFocus as ((e: FocusEvent<HTMLElement>) => void) | undefined)?.(event)
        if (enabled && focusIsVisible(event.currentTarget) && showsFor(event.currentTarget, options.whenClipped)) {
          activate({ anchor: options.anchorTo?.() ?? event.currentTarget, source: event.currentTarget, by: 'focus' })
        }
      },
    }),
    node: active && enabled ? <TooltipLayer key={active.by} active={active} text={text} options={options} onClose={close} /> : null,
  }
}

/** For a name that only repeats what is written: a tooltip only when the text is cut off (an ellipsis). */
function showsFor(element: HTMLElement, whenClipped: boolean | undefined): boolean {
  return !whenClipped || element.scrollWidth > element.clientWidth
}

/**
 * Keyboard focus, not the focus a mouse press leaves behind. Where the browser cannot say, count it. A label (a checkbox row with a tooltip,
 * H-022) is never the focused element itself: its control is, so that is the one asked.
 */
function focusIsVisible(element: HTMLElement): boolean {
  try {
    const focused = element instanceof HTMLLabelElement ? (element.control ?? element) : element

    return focused.matches(':focus-visible')
  } catch {
    return true
  }
}

function TooltipLayer({ active, text, options, onClose }: { active: Active; text: string; options: TooltipOptions; onClose: () => void }) {
  const id = useId()
  const [shown, setShown] = useState(active.by === 'focus')
  const { refs, floatingStyles, isPositioned } = useFloating({
    open: shown,
    elements: { reference: active.anchor },
    placement: options.placement ?? 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  useEffect(() => {
    const { source, by } = active
    const timer = by === 'hover' ? setTimeout(() => setShown(true), TOOLTIP_DELAY_MS) : undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    source.addEventListener(by === 'hover' ? 'pointerleave' : 'blur', onClose)
    source.addEventListener('pointerdown', onClose)
    document.addEventListener('keydown', onKey)

    return () => {
      clearTimeout(timer)
      source.removeEventListener(by === 'hover' ? 'pointerleave' : 'blur', onClose)
      source.removeEventListener('pointerdown', onClose)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, onClose])

  // While it is up the element is described by it (a screen reader hears it once it appears).
  useEffect(() => {
    if (!shown) return
    const { anchor } = active
    const before = anchor.getAttribute('aria-describedby')
    anchor.setAttribute('aria-describedby', id)

    return () => {
      if (before === null) anchor.removeAttribute('aria-describedby')
      else anchor.setAttribute('aria-describedby', before)
    }
  }, [shown, active, id])

  if (!shown) return null

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        id={id}
        role="tooltip"
        className={options.mono ? 'q-tooltip mono' : 'q-tooltip'}
        style={{ ...floatingStyles, opacity: isPositioned ? 1 : 0 }}
      >
        {text}
      </div>
    </FloatingPortal>
  )
}
