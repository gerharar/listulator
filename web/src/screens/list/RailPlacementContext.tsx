import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CARRY_FLOOR_WIDTH, railPlacement, type RailPlacement } from './railPlacement.js'

export interface RailPlacementState {
  placement: RailPlacement
  windowWidth: number
  /**
   * The rail came inside as the window narrowed, so its width follows the window (`carriedRailWidth`) until the reader resizes it or the window
   * goes wide enough to put it outside again. A window that opened inside, or was narrowed inside, has no carry: the stored width is shown.
   */
  carried?: boolean
  /** Ends the carry: the reader has set a width. */
  release?: () => void
}

const INSIDE: RailPlacementState = { placement: 'inside', windowWidth: 0 }

const RailPlacementContext = createContext<RailPlacementState>(INSIDE)

/**
 * The window's rail placement (H-019): re-evaluated on window resize only, with
 * the rule's hysteresis kept in state. One per window; the layers read it from
 * the context so every layer agrees.
 */
export function useWindowRailPlacement(): RailPlacementState & { carried: boolean; release: () => void } {
  const [state, setState] = useState<{ placement: RailPlacement; windowWidth: number; carried: boolean }>(() => ({
    placement: railPlacement(window.innerWidth, 'inside'),
    windowWidth: window.innerWidth,
    carried: false,
  }))

  useEffect(() => {
    const onResize = () =>
      setState((current) => {
        const placement = railPlacement(window.innerWidth, current.placement)
        const carried = placement === 'inside' && (current.carried || current.placement === 'outside')

        // Inside with no carry nothing reads the width: leave the state alone, so dragging a narrow window redraws nothing. The same once a
        // carried rail is at its minimum: a window narrower still (both widths at the floor or below) draws the same rail.
        if (placement === 'inside' && !carried) return current
        if (carried && placement === current.placement && current.windowWidth <= CARRY_FLOOR_WIDTH && window.innerWidth <= CARRY_FLOOR_WIDTH) return current

        return placement === current.placement && carried === current.carried && window.innerWidth === current.windowWidth
          ? current
          : { placement, windowWidth: window.innerWidth, carried }
      })

    window.addEventListener('resize', onResize)

    return () => window.removeEventListener('resize', onResize)
  }, [])

  const release = useCallback(() => setState((current) => (current.carried ? { ...current, carried: false } : current)), [])

  return useMemo(() => ({ ...state, release }), [state, release])
}

export function RailPlacementProvider({ value, children }: { value: RailPlacementState; children: ReactNode }) {
  return <RailPlacementContext.Provider value={value}>{children}</RailPlacementContext.Provider>
}

/** Where the rail sits; without a provider (a screen on its own) it is inside, as before. */
export function useRailPlacement(): RailPlacementState {
  return useContext(RailPlacementContext)
}
