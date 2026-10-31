import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { setShowTimeLeft } from '../../../lib/preferences/timeLeft.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'

interface TimeLeftValue {
  on: boolean
  setOn: (on: boolean) => void
}

/** Off, and nothing to write: a screen drawn outside the shell (a test) behaves as the default does. */
const STANDALONE: TimeLeftValue = { on: false, setOn: () => undefined }

const TimeLeftContext = createContext<TimeLeftValue>(STANDALONE)

/**
 * Whether the `showTimeLeft` preference is on, and the switch for it (canvas H-024). `on` is the value App read at start; the state lives here, as
 * `GroupLineProvider` keeps Enhance group arrows, so the Settings checkbox changes My Lists at once. With a `store` a change is also written;
 * without one (a test) it only changes.
 */
export function TimeLeftProvider({ on, store, children }: { on: boolean; store?: PreferencesStore; children: ReactNode }) {
  const [current, setCurrent] = useState(on)
  const setOn = useCallback(
    (next: boolean) => {
      setCurrent(next)
      if (store) void setShowTimeLeft(store, next)
    },
    [store],
  )
  const value = useMemo<TimeLeftValue>(() => ({ on: current, setOn }), [current, setOn])

  return <TimeLeftContext.Provider value={value}>{children}</TimeLeftContext.Provider>
}

/** The setting and its switch: the Settings checkbox uses both, My Lists only reads `on`. */
export function useTimeLeftSetting(): TimeLeftValue {
  return useContext(TimeLeftContext)
}
