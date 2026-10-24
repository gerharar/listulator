import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { railPlacement, type RailPlacement } from './railPlacement.js'

export interface RailPlacementState {
  placement: RailPlacement
  windowWidth: number
}

const INSIDE: RailPlacementState = { placement: 'inside', windowWidth: 0 }

const RailPlacementContext = createContext<RailPlacementState>(INSIDE)

/**
 * The window's rail placement (H-019): re-evaluated on window resize only, with
 * the rule's hysteresis kept in state. One per window; the layers read it from
 * the context so every layer agrees.
 */
export function useWindowRailPlacement(): RailPlacementState {
  const [state, setState] = useState<RailPlacementState>(() => ({
    placement: railPlacement(window.innerWidth, 'inside'),
    windowWidth: window.innerWidth,
  }))

  useEffect(() => {
    const onResize = () =>
      setState((current) => {
        const placement = railPlacement(window.innerWidth, current.placement)

        return placement === current.placement && window.innerWidth === current.windowWidth
          ? current
          : { placement, windowWidth: window.innerWidth }
      })

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [])

  return state
}

export function RailPlacementProvider({ value, children }: { value: RailPlacementState; children: ReactNode }) {
  return <RailPlacementContext.Provider value={value}>{children}</RailPlacementContext.Provider>
}

/** Where the rail sits; without a provider (a screen on its own) it is inside, as before. */
export function useRailPlacement(): RailPlacementState {
  return useContext(RailPlacementContext)
}
