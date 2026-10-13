import { useSyncExternalStore } from 'react'

/**
 * The screen's device pixel ratio (1.25 for a Windows display at 125%), read again when it changes: a browser zoom,
 * a window dragged to a screen with another scale. One shared `matchMedia` listener serves every component that asks
 * (a My Lists page has a meter per row). A browser without `matchMedia` just keeps the value it has.
 */
const listeners = new Set<() => void>()
let stopWatching: (() => void) | null = null

// `(resolution: <ratio>dppx)` stops matching when the ratio moves away from it, so each change re-arms the query on the new ratio.
function watch(): void {
  const query = matchMedia(`(resolution: ${globalThis.devicePixelRatio}dppx)`)
  const onChange = (): void => {
    stopWatching?.()
    watch()
    listeners.forEach((listener) => listener())
  }
  query.addEventListener('change', onChange)
  stopWatching = () => query.removeEventListener('change', onChange)
}

function subscribe(listener: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined
  listeners.add(listener)
  if (listeners.size === 1) watch()

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopWatching?.()
      stopWatching = null
    }
  }
}

const snapshot = (): number => {
  const ratio = globalThis.devicePixelRatio

  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 1)
}
