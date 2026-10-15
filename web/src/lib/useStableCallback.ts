import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * A function whose identity never changes and which always calls the latest `fn` (the "event handler" pattern). A memoized child
 * that is given it is not re-rendered because its parent was, and what it calls still sees the parent's current state: that is what
 * lets one ticked row re-render alone on a list of thousands (Phase 25.0b). The latest function is set after each commit, so it is
 * for handlers (called from events and effects), never for something called while rendering.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(fn)
  useLayoutEffect(() => {
    latest.current = fn
  })

  return useCallback((...args: Args) => latest.current(...args), [])
}
