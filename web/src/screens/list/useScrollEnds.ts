import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { atEnds } from './listEnds.js'

export interface ScrollEnds {
  /** The scroll area's height, for "taller than two screens". */
  viewportHeight: number
  atTop: boolean
  atBottom: boolean
}

/**
 * Where a scroller is, as state: its height and which end it is at. Read again on every scroll, when it is resized and when `rowsKey` changes
 * (a fold or a filter changes the height without a scroll). It only sets state when an answer changes, so a scroll that stays between the
 * ends redraws nothing.
 */
export function useScrollEnds(scroller: RefObject<HTMLElement | null>, rowsKey: unknown): ScrollEnds {
  const [ends, setEnds] = useState<ScrollEnds>({ viewportHeight: 0, atTop: true, atBottom: false })

  function read() {
    const element = scroller.current
    if (!element) return
    const next = { viewportHeight: element.clientHeight, ...atEnds(element.scrollTop, element.clientHeight, element.scrollHeight) }
    setEnds((current) => (current.viewportHeight === next.viewportHeight && current.atTop === next.atTop && current.atBottom === next.atBottom ? current : next))
  }

  useLayoutEffect(read, [rowsKey])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    element.addEventListener('scroll', read, { passive: true })
    // No layout to observe in jsdom.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    observer?.observe(element)

    return () => {
      element.removeEventListener('scroll', read)
      observer?.disconnect()
    }
  }, [])

  return ends
}
