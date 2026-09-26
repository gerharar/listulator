import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../../../lib/usePrefersReducedMotion.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { setReducedMotionSetting as persistReducedMotion } from '../../../lib/preferences/motion.js'

export interface MotionContextValue {
  /** What the app does: the user's own choice if they made one, else the system's. */
  reduced: boolean
  /** The Settings checkbox reads this: `undefined` until the user chooses. */
  reducedSetting: boolean | undefined
  setReducedMotion: (reduced: boolean) => void
}

const MotionReactContext = createContext<MotionContextValue | null>(null)

const STANDALONE: MotionContextValue = {
  reduced: false,
  reducedSetting: undefined,
  setReducedMotion: () => {},
}

export interface MotionProviderProps {
  initialReducedSetting: boolean | undefined
  store: PreferencesStore
  children: ReactNode
}

/**
 * The reduce-motion switch (task 10.30; the Fast push mode beside it was removed, F14). The prototype
 * ticks the box itself from the system's setting on load and lets the user
 * untick it; keeping "never chosen" apart from "chose no" gives the same result
 * and still follows the system if it changes later.
 */
export function MotionProvider({ initialReducedSetting, store, children }: MotionProviderProps) {
  const [reducedSetting, setReducedSetting] = useState<boolean | undefined>(initialReducedSetting)
  const systemReduced = usePrefersReducedMotion()

  const setReducedMotion = useCallback(
    (next: boolean) => {
      setReducedSetting(next)
      void persistReducedMotion(store, next)
    },
    [store],
  )

  const value = useMemo<MotionContextValue>(
    () => ({ reduced: reducedSetting ?? systemReduced, reducedSetting, setReducedMotion }),
    [reducedSetting, systemReduced, setReducedMotion],
  )

  return <MotionReactContext.Provider value={value}>{children}</MotionReactContext.Provider>
}

/** Outside a provider (a component alone in a test): motion on. */
export function useMotion(): MotionContextValue {
  return useContext(MotionReactContext) ?? STANDALONE
}

/** Whether to skip animation that carries meaning — the app's setting when there is one, the system's otherwise. */
export function useReducedMotion(): boolean {
  const context = useContext(MotionReactContext)
  const system = usePrefersReducedMotion()
  return context ? context.reduced : system
}
