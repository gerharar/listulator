import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../../../lib/usePrefersReducedMotion.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import {
  setMotion as persistMotion,
  setReducedMotionSetting as persistReducedMotion,
  type Motion,
} from '../../../lib/preferences/motion.js'

export interface MotionContextValue {
  motion: Motion
  /** What the app does: the user's own choice if they made one, else the system's. */
  reduced: boolean
  /** The Settings checkbox reads this: `undefined` until the user chooses. */
  reducedSetting: boolean | undefined
  setMotion: (motion: Motion) => void
  setReducedMotion: (reduced: boolean) => void
}

const MotionReactContext = createContext<MotionContextValue | null>(null)

const STANDALONE: MotionContextValue = {
  motion: 'drum',
  reduced: false,
  reducedSetting: undefined,
  setMotion: () => {},
  setReducedMotion: () => {},
}

export interface MotionProviderProps {
  initialMotion: Motion
  initialReducedSetting: boolean | undefined
  store: PreferencesStore
  children: ReactNode
}

/**
 * The motion mode and the reduce-motion switch (task 10.30). The prototype
 * ticks the box itself from the system's setting on load and lets the user
 * untick it; keeping "never chosen" apart from "chose no" gives the same result
 * and still follows the system if it changes later.
 */
export function MotionProvider({ initialMotion, initialReducedSetting, store, children }: MotionProviderProps) {
  const [motion, setMotionState] = useState<Motion>(initialMotion)
  const [reducedSetting, setReducedSetting] = useState<boolean | undefined>(initialReducedSetting)
  const systemReduced = usePrefersReducedMotion()

  const setMotion = useCallback(
    (next: Motion) => {
      setMotionState(next)
      void persistMotion(store, next)
    },
    [store],
  )
  const setReducedMotion = useCallback(
    (next: boolean) => {
      setReducedSetting(next)
      void persistReducedMotion(store, next)
    },
    [store],
  )

  const value = useMemo<MotionContextValue>(
    () => ({ motion, reduced: reducedSetting ?? systemReduced, reducedSetting, setMotion, setReducedMotion }),
    [motion, reducedSetting, systemReduced, setMotion, setReducedMotion],
  )

  return <MotionReactContext.Provider value={value}>{children}</MotionReactContext.Provider>
}

/** Outside a provider (a component alone in a test): the drum carousel, motion on. */
export function useMotion(): MotionContextValue {
  return useContext(MotionReactContext) ?? STANDALONE
}

/** Whether to skip animation that carries meaning — the app's setting when there is one, the system's otherwise. */
export function useReducedMotion(): boolean {
  const context = useContext(MotionReactContext)
  const system = usePrefersReducedMotion()
  return context ? context.reduced : system
}
