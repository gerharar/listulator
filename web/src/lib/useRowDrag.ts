import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * Dragging a row by its handle, on raw pointer events (D7): no native
 * HTML5 drag-and-drop (broken in WKWebView, `docs/DECISIONS.md`) and no
 * library. Ported from task 6.7's `handleItemPointerDown` in the old
 * `ListDetail.tsx` — a movement threshold before anything counts as a drag
 * (so a plain click on the handle stays a click), `document.elementFromPoint`
 * to find the row under the pointer, and a drop read from where the pointer
 * is released — and extended for the new list screen: before/after by the
 * row's half (the prototype's `overPos`), a caller-decided `accepts`, Escape
 * and `pointercancel`, autoscroll, and no text selection while it lasts
 * (BL-019).
 *
 * Rows opt in with a `data-drag-key`; the handle calls `startDrag`. The handle
 * should set `touch-action: none` so a finger drags rather than scrolls; the
 * rest of the row stays free to scroll.
 */
export interface DropTarget {
  key: string
  pos: 'before' | 'after'
}

export interface RowDragOptions {
  /** May `dragKey` be dropped on the row `targetKey`? Never asked about the dragged row itself. */
  accepts: (dragKey: string, targetKey: string) => boolean
  onDrop: (dragKey: string, target: DropTarget) => void
  onStart?: (dragKey: string) => void
  /** However it ended: dropped, escaped or cancelled. */
  onEnd?: () => void
  /** The scrollable ancestor to nudge while the pointer is near its edge; found from the handle if omitted. */
  scrollContainer?: (from: HTMLElement) => HTMLElement | null
}

/** Pixels the pointer must travel before it is a drag rather than a click. */
const THRESHOLD = 6
const EDGE = 48
const MAX_SPEED = 18

/** How far to scroll this frame: negative near the top edge, positive near the bottom, faster the closer. */
export function autoscrollDelta(y: number, rect: { top: number; bottom: number }): number {
  if (y < rect.top + EDGE) return -Math.min(MAX_SPEED, Math.ceil(((rect.top + EDGE - y) / EDGE) * MAX_SPEED))
  if (y > rect.bottom - EDGE) return Math.min(MAX_SPEED, Math.ceil(((y - (rect.bottom - EDGE)) / EDGE) * MAX_SPEED))

  return 0
}

function scrollParent(from: HTMLElement | null): HTMLElement | null {
  for (let node = from?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }

  return null
}

export function useRowDrag(options: RowDragOptions) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)
  // The gesture's listeners outlive a render, so they read the latest options from here.
  const latest = useRef(options)
  latest.current = options
  const cleanup = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanup.current?.(), [])

  const startDrag = useCallback((event: ReactPointerEvent, key: string) => {
    if (event.button !== 0) return
    cleanup.current?.()

    const startX = event.clientX
    const startY = event.clientY
    const handle = event.currentTarget as HTMLElement
    let dragging = false
    let x = startX
    let y = startY
    let frame = 0
    let scroller: HTMLElement | null = null

    function targetAt(px: number, py: number): DropTarget | null {
      const row = document.elementFromPoint(px, py)?.closest<HTMLElement>('[data-drag-key]')
      const targetKey = row?.dataset['dragKey']
      if (!row || !targetKey || targetKey === key || !latest.current.accepts(key, targetKey)) return null

      const rect = row.getBoundingClientRect()

      return { key: targetKey, pos: py < rect.top + rect.height / 2 ? 'before' : 'after' }
    }

    function tick() {
      if (!dragging) return
      if (scroller) {
        const delta = autoscrollDelta(y, scroller.getBoundingClientRect())
        if (delta !== 0) {
          scroller.scrollTop += delta
          setOver(targetAt(x, y))
        }
      }
      frame = requestAnimationFrame(tick)
    }

    function finish(drop: boolean, px: number, py: number) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('selectstart', noSelect, true)
      cancelAnimationFrame(frame)
      cleanup.current = null

      const target = dragging && drop ? targetAt(px, py) : null
      const wasDragging = dragging
      dragging = false
      document.body.classList.remove('q-dragging')
      setDragKey(null)
      setOver(null)

      if (target) latest.current.onDrop(key, target)
      if (wasDragging) latest.current.onEnd?.()
    }

    function onMove(moveEvent: PointerEvent) {
      x = moveEvent.clientX
      y = moveEvent.clientY

      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < THRESHOLD) return
        dragging = true
        document.body.classList.add('q-dragging')
        // A selection begun before the drag (or by WebKit at the press) would grow as the list scrolls.
        window.getSelection()?.removeAllRanges()
        setDragKey(key)
        latest.current.onStart?.(key)
        scroller = (latest.current.scrollContainer ?? scrollParent)(handle)
        frame = requestAnimationFrame(tick)
      }

      // Only once it is a drag: a plain click must still reach whatever it landed on.
      moveEvent.preventDefault()
      setOver(targetAt(x, y))
    }

    const onUp = (upEvent: PointerEvent) => finish(true, upEvent.clientX, upEvent.clientY)
    const onCancel = () => finish(false, x, y)
    // From the press on, not only once it is a drag: WebKit starts a selection at the
    // press and ignores unprefixed `user-select`, so autoscroll would extend it (BL-019).
    const noSelect = (selectEvent: Event) => selectEvent.preventDefault()
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      // Ours alone: the Esc ladder listens on `document`, which a window
      // listener would only reach after it had already popped the layer.
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      finish(false, x, y)
    }

    cleanup.current = () => finish(false, x, y)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('selectstart', noSelect, true)
  }, [])

  return { dragKey, over, startDrag }
}
