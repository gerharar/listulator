import { useEffect, type RefObject } from 'react'

/**
 * The tint a list row takes under the mouse (BL-105), driven by the pointer's own events instead of the engine's `:hover`. After an item
 * is dragged, the Mac app's webview (WKWebView) left rows that had been under the pointer on the way tinted until the mouse came back to them
 * (the engine's hover state is only recomputed from real mouse moves, and a drag's moves, and the scroll under a still pointer, are not).
 * Here a row has the tint only while a mouse or pen has last moved over it, never while an item is carried (`suspended`), and a scroll
 * under a still pointer hands it to the row that arrives. The mark is an attribute, `data-pointer`, so that React drawing the row again
 * with another class (a tick) does not wipe it. Touch has no hover, so a tap leaves nothing behind.
 */
export const POINTER_ATTRIBUTE = 'data-pointer'

export function useRowHover(container: RefObject<HTMLElement | null>, suspended: boolean): void {
  useEffect(() => {
    const list = container.current
    if (!list) return

    let current: Element | null = null
    let last: { x: number; y: number } | null = null
    let frame = 0

    const set = (row: Element | null) => {
      if (row === current) return
      current?.removeAttribute(POINTER_ATTRIBUTE)
      current = row
      current?.setAttribute(POINTER_ATTRIBUTE, '')
    }
    const clear = () => {
      cancelAnimationFrame(frame)
      last = null
      set(null)
    }
    const rowAt = (target: EventTarget | null) => (target instanceof Element ? target.closest('.q-item') : null)

    // Carrying an item: nothing is tinted, and what the pointer passes over is not either.
    if (suspended) {
      clear()
      return
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      last = { x: event.clientX, y: event.clientY }
      set(rowAt(event.target))
    }
    // The list moves under a still pointer (the wheel, a jump, the autoscroll): the row that arrives under it is the one.
    const onScroll = () => {
      if (!last) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (last) set(rowAt(document.elementFromPoint(last.x, last.y)))
      })
    }

    list.addEventListener('pointermove', onMove)
    list.addEventListener('pointerleave', clear)
    list.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('blur', clear)

    return () => {
      list.removeEventListener('pointermove', onMove)
      list.removeEventListener('pointerleave', clear)
      list.removeEventListener('scroll', onScroll)
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [container, suspended])
}
