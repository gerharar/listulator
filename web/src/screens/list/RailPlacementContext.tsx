import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTheme } from '../../components/quantum/DocumentTheme/ThemeContext.js'
import { appWidth, carryFloorWidth, railPlacement, type RailPlacement } from './railPlacement.js'

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
 * The window's rail placement (H-019): re-evaluated on window resize and when the theme changes (Phase 49.7: the card's width, the gap and the cap on the
 * app are the theme's), with the rule's hysteresis kept in state. One per window; the layers read it from the context so every layer agrees.
 */
export function useWindowRailPlacement(): RailPlacementState & { carried: boolean; release: () => void } {
  const [state, setState] = useState<{ placement: RailPlacement; windowWidth: number; carried: boolean }>(() => ({
    placement: railPlacement(appWidth(window.innerWidth), 'inside'),
    windowWidth: appWidth(window.innerWidth),
    carried: false,
  }))

  // The same evaluation for a resize and for a theme change: the window's width is read as the app's (up to the cap the theme sets), the rule is applied
  // to the card and gap the page has now, and the hysteresis and the carry follow from where the rail was.
  const evaluate = useCallback(() => {
    setState((current) => {
      // The app's width: the window's up to the cap a theme sets on the app (appWidth).
      const width = appWidth(window.innerWidth)
      const placement = railPlacement(width, current.placement)
      const floor = carryFloorWidth()
      const carried = placement === 'inside' && (current.carried || current.placement === 'outside')

      // Inside with no carry nothing reads the width: leave the state alone, so dragging a narrow window redraws nothing. The same once a
      // carried rail is at its minimum: a window narrower still (both widths at the floor or below) draws the same rail.
      if (placement === 'inside' && !carried) return current
      if (carried && placement === current.placement && current.windowWidth <= floor && width <= floor) return current

      return placement === current.placement && carried === current.carried && width === current.windowWidth
        ? current
        : { placement, windowWidth: width, carried }
    })
  }, [])

  useEffect(() => {
    window.addEventListener('resize', evaluate)

    return () => window.removeEventListener('resize', evaluate)
  }, [evaluate])

  // Not on the first render (the state was just worked out from the page): only when the theme is another one. A layout effect, so the layers are not
  // painted once at the old theme's placement. The shell has put the new class on <html> before the render that carries the new theme.
  const theme = useTheme()
  const themeSeen = useRef(theme)
  useLayoutEffect(() => {
    if (themeSeen.current === theme) return
    themeSeen.current = theme
    evaluate()
  }, [theme, evaluate])

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
