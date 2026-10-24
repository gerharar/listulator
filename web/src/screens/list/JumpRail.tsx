import './JumpRail.css'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { copy } from '../../locale/index.js'
import { RAIL_WIDTH_DEFAULT, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from './collapse.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'

export interface RailEntry {
  id: string
  name: string
  /** Absent in a Preview, which has nothing done: the entry then shows how many items the group has, and never a tick. */
  done?: number
  total: number
}

interface JumpRailBase {
  entries: readonly RailEntry[]
  onJump: (entry: RailEntry) => void
  onHide: () => void
  width: number
  /** Live, while the edge is dragged or an arrow key is held. */
  onResize: (width: number) => void
  /** Once, when a resize settles: the width to remember. */
  onResizeEnd: (width: number) => void
}

/** In the card: the grip is on the right edge, and a folded rail is swapped for `JumpRailStub`, so nothing here folds. */
interface InsideRail {
  placement?: 'inside'
  folded?: never
  onShow?: never
  maxWidth?: never
}

/** Outside the card (H-019) the grip is on the outer edge and the rail folds in place to a strip; these go together or the strip cannot be unfolded. */
interface OutsideRail {
  placement: 'outside'
  /** The rail is folded to its strip. */
  folded: boolean
  /** The strip is pressed. */
  onShow: () => void
  /** The widest the rail may be here (the window's room beside the card, less 16px); the cap is never stored. */
  maxWidth: number
}

export type JumpRailProps = JumpRailBase & (InsideRail | OutsideRail)

const STEP = 16
/** The folded strip outside the card (H-019); the one inside the card is still `JumpRailStub`'s 36px. */
export const RAIL_FOLDED_WIDTH = 38
/** How long the width animates when the rail folds or unfolds (`JumpRail.css`, plus a frame). */
const FOLD_MS = 240

/**
 * The jump rail (design: JumpRail, 200px): every group that has items, with
 * what is done in it and a tick once all of it is. A click opens the group
 * and brings it to the top. It never follows a filter: it is the map of the
 * whole list. Its edge drags to widen it (F12, beyond the design's fixed
 * 200px: long group names were cut off): the right edge inside the card, the
 * left edge outside it, where dragging left widens. Arrow keys on the edge do
 * the same (mirrored outside) and a double-click puts it back.
 */
export function JumpRail(props: JumpRailProps) {
  const { entries, onJump, onHide, width, onResize, onResizeEnd } = props
  const text = copy.quantum.list.rail
  const out = props.placement === 'outside' ? props : null
  const outside = out !== null
  const folded = out?.folded ?? false
  const limit = out ? Math.min(RAIL_WIDTH_MAX, out.maxWidth) : RAIL_WIDTH_MAX
  // Dragging left widens it outside, right inside: the grip is on the other edge.
  const direction = outside ? -1 : 1
  const [dragging, setDragging] = useState(false)
  const [folding, setFolding] = useState(false)
  const lastFolded = useRef(folded)

  // The width animates when the rail folds or unfolds, and only then: not on mount, not while it is dragged, not when the window's cap moves it.
  useEffect(() => {
    if (lastFolded.current === folded) return
    lastFolded.current = folded
    setFolding(true)
    const timer = window.setTimeout(() => setFolding(false), FOLD_MS)

    return () => window.clearTimeout(timer)
  }, [folded])

  function fit(next: number): number {
    return Math.round(Math.min(limit, Math.max(RAIL_WIDTH_MIN, next)))
  }

  function set(next: number) {
    const clamped = fit(next)
    onResize(clamped)
    onResizeEnd(clamped)
  }

  function startResize(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    let current = width
    document.body.classList.add('q-resizing')
    setDragging(true)

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      current = fit(width + (moveEvent.clientX - startX) * direction)
      onResize(current)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('q-resizing')
      setDragging(false)
      onResizeEnd(current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function onGripKey(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      set(width + (event.key === 'ArrowRight' ? STEP : -STEP) * direction)
    }
  }

  const className = ['q-rail', outside && 'q-rail-out', outside && folded && 'is-folded', outside && folding && 'is-folding', dragging && 'is-dragging']
    .filter(Boolean)
    .join(' ')

  return (
    <nav className={className} data-placement={outside ? 'outside' : 'inside'} aria-label={text.title} style={{ width: outside && folded ? RAIL_FOLDED_WIDTH : width }}>
      {outside && folded ? (
        // The whole strip is the way back (as `JumpRailStub`); the » inside is a real button for the keyboard, its click reaches the strip's handler.
        <Tip as="div" className="q-rail-fold" text={text.show} onClick={out?.onShow}>
          <button type="button" className="q-rail-toggle" aria-label={text.show}>
            »
          </button>
          <span className="label">{text.title}</span>
        </Tip>
      ) : (
        <>
          <Tip
            className={outside ? 'q-rail-grip q-rail-grip-out' : 'q-rail-grip'}
            role="separator"
            aria-orientation="vertical"
            aria-label={text.resize}
            text={text.resize}
            aria-valuenow={width}
            aria-valuemin={RAIL_WIDTH_MIN}
            aria-valuemax={limit}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={onGripKey}
            onDoubleClick={() => set(RAIL_WIDTH_DEFAULT)}
          />
          <div className="q-rail-scroll">
            <div className="q-rail-head">
              <span className="q-kicker">{text.title}</span>
              <Tip as="button" type="button" className="q-rail-toggle" aria-label={text.hide} text={text.hide} onClick={onHide}>
                «
              </Tip>
            </div>
            {entries.map((entry) => {
              const complete = entry.done !== undefined && entry.total > 0 && entry.done === entry.total

              return (
                <button
                  key={entry.id}
                  type="button"
                  className={complete ? 'q-rail-entry complete' : 'q-rail-entry'}
                  onClick={() => onJump(entry)}
                >
                  <span className="tick" aria-hidden="true">
                    {complete ? '✓' : ''}
                  </span>
                  <span className="name">{entry.name}</span>
                  <span className="count">{entry.done === undefined ? entry.total : `${entry.done}/${entry.total}`}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </nav>
  )
}

/**
 * What is left of the rail when it is folded away: a 36px strip with a way back.
 * The whole strip is the way back (owner); the » button is its keyboard stop,
 * and its click reaches the strip's handler.
 */
export function JumpRailStub({ onShow }: { onShow: () => void }) {
  const text = copy.quantum.list.rail

  return (
    // The tooltip is the strip's alone: a second one on the » button would open beside it.
    <Tip as="div" className="q-rail-stub" data-placement="inside" text={text.show} onClick={onShow}>
      <button type="button" className="q-rail-toggle" aria-label={text.show}>
        »
      </button>
      <span className="label">{text.title}</span>
    </Tip>
  )
}
