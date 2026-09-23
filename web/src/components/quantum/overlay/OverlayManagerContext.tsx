import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { createOverlayManager, type OverlayKind, type OverlayManager } from './overlayManager.js'
import { handleEscape } from './escLadder.js'

const OverlayManagerReactContext = createContext<OverlayManager | null>(null)

/** One shared manager for the whole app — mount once, near the root. */
export function OverlayManagerProvider({ children }: { children: ReactNode }) {
  const manager = useMemo(() => createOverlayManager(), [])
  return (
    <OverlayManagerReactContext.Provider value={manager}>
      {children}
    </OverlayManagerReactContext.Provider>
  )
}

export function useOverlayManager(): OverlayManager {
  const manager = useContext(OverlayManagerReactContext)
  if (!manager) {
    throw new Error('useOverlayManager must be used within an OverlayManagerProvider')
  }
  return manager
}

/**
 * Registers an overlay (a popover or a sheet) with the shared manager for
 * as long as it's open. `close` is read through a ref so passing a fresh
 * arrow function each render doesn't churn the registration.
 */
export function useOverlayRegistration(
  kind: OverlayKind,
  id: string,
  open: boolean,
  close: () => void,
): void {
  const manager = useOverlayManager()
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return undefined
    manager.register({ id, kind, close: () => closeRef.current() })
    return () => manager.unregister(id)
  }, [manager, id, kind, open])
}

/**
 * Wires the real Escape key to the ladder: the topmost popover or sheet
 * first, then `popLayer`. Call once, near the app root — the LayerStack
 * (10.9) supplies the real `popLayer`; nothing does yet.
 */
export function useEscLadder(popLayer: () => void): void {
  const manager = useOverlayManager()
  const popLayerRef = useRef(popLayer)
  popLayerRef.current = popLayer

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      handleEscape(manager, () => popLayerRef.current())
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [manager])
}
