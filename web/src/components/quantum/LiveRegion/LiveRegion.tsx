import './LiveRegion.css'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export interface LiveRegionContextValue {
  announce: (message: string) => void
}

const LiveRegionReactContext = createContext<LiveRegionContextValue | null>(null)

/**
 * `.q-live`, `aria-live="polite"` (design-system README, Overlays section).
 * Every toast has a sentence here too ("Restored X", "Sorted by date"), but
 * this exists independently — a change that has no visible toast (a row's
 * new position number) can still announce through it directly.
 */
export function LiveRegionProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')

  const announce = useCallback((next: string) => {
    // Clear first: a screen reader only fires on a text change, so the same
    // sentence said twice in a row would otherwise go unannounced the second time.
    setMessage('')
    requestAnimationFrame(() => setMessage(next))
  }, [])

  return (
    <LiveRegionReactContext.Provider value={{ announce }}>
      {children}
      <div className="q-live" aria-live="polite">
        {message}
      </div>
    </LiveRegionReactContext.Provider>
  )
}

export function useLiveRegion(): LiveRegionContextValue {
  const context = useContext(LiveRegionReactContext)
  if (!context) {
    throw new Error('useLiveRegion must be used within a LiveRegionProvider')
  }
  return context
}
