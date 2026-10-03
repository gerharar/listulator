import { useEffect, useRef } from 'react'

/**
 * Calls `tick` every `intervalMs` while `active` (task 15.7: a list reads itself again while some of its
 * lengths are still being looked up), and not at all otherwise.
 *
 * It waits while the page is hidden, never starts a call while the last is still running, uses the latest
 * `tick` without restarting the clock, and survives a call that fails: a read that did not get through is
 * simply tried again at the next beat, and the caller keeps what it has.
 */
export function usePolling(active: boolean, tick: () => void | Promise<void>, intervalMs: number): void {
  const latest = useRef(tick)

  useEffect(() => {
    latest.current = tick
  })

  useEffect(() => {
    if (!active) return

    let running = false
    const timer = setInterval(() => {
      if (running || document.visibilityState === 'hidden') return

      running = true
      Promise.resolve()
        .then(() => latest.current())
        .catch(() => undefined)
        .finally(() => {
          running = false
        })
    }, intervalMs)

    return () => clearInterval(timer)
  }, [active, intervalMs])
}
