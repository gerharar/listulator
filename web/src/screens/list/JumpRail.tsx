import './JumpRail.css'
import type { KeyboardEvent, PointerEvent } from 'react'
import { copy } from '../../locale/index.js'
import { clampRailWidth, RAIL_WIDTH_DEFAULT, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from './collapse.js'

export interface RailEntry {
  id: string
  name: string
  done: number
  total: number
}

export interface JumpRailProps {
  entries: readonly RailEntry[]
  onJump: (entry: RailEntry) => void
  onHide: () => void
  width: number
  /** Live, while the edge is dragged or an arrow key is held. */
  onResize: (width: number) => void
  /** Once, when a resize settles: the width to remember. */
  onResizeEnd: (width: number) => void
}

const STEP = 16

/**
 * The jump rail (design: JumpRail, 200px): every group that has items, with
 * what is done in it and a tick once all of it is. A click opens the group
 * and brings it to the top. It never follows a filter: it is the map of the
 * whole list. Its right edge drags to widen it (F12, beyond the design's fixed
 * 200px: long group names were cut off); arrow keys on the edge do the same,
 * and a double-click puts it back.
 */
export function JumpRail({ entries, onJump, onHide, width, onResize, onResizeEnd }: JumpRailProps) {
  const text = copy.quantum.list.rail

  function set(next: number) {
    const clamped = clampRailWidth(next)
    onResize(clamped)
    onResizeEnd(clamped)
  }

  function startResize(event: PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    let current = width
    document.body.classList.add('q-resizing')

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      current = clampRailWidth(width + moveEvent.clientX - startX)
      onResize(current)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('q-resizing')
      onResizeEnd(current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  function onGripKey(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      set(width + (event.key === 'ArrowRight' ? STEP : -STEP))
    }
  }

  return (
    <nav className="q-rail" aria-label={text.title} style={{ width }}>
      <span
        className="q-rail-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label={text.resize}
        title={text.resize}
        aria-valuenow={width}
        aria-valuemin={RAIL_WIDTH_MIN}
        aria-valuemax={RAIL_WIDTH_MAX}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={onGripKey}
        onDoubleClick={() => set(RAIL_WIDTH_DEFAULT)}
      />
      <div className="q-rail-scroll">
        <div className="q-rail-head">
          <span className="q-kicker">{text.title}</span>
          <button
            type="button"
            className="q-rail-toggle"
            aria-label={text.hide}
            title={text.hide}
            onClick={onHide}
          >
            «
          </button>
        </div>
        {entries.map((entry) => {
          const complete = entry.total > 0 && entry.done === entry.total

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
              <span className="count">
                {entry.done}/{entry.total}
              </span>
            </button>
          )
        })}
      </div>
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
    <div className="q-rail-stub" title={text.show} onClick={onShow}>
      <button
        type="button"
        className="q-rail-toggle"
        aria-label={text.show}
        title={text.show}
      >
        »
      </button>
      <span className="label">{text.title}</span>
    </div>
  )
}
