import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { setSpectrumBorder } from '../../../lib/preferences/spectrumBorder.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'

interface SpectrumBorderValue {
  on: boolean
  setOn: (on: boolean) => void
}

/** On, and nothing to write or to change on the page: a screen drawn outside the shell (a test) behaves as the default does. */
const STANDALONE: SpectrumBorderValue = { on: true, setOn: () => undefined }

const SpectrumBorderContext = createContext<SpectrumBorderValue>(STANDALONE)

/**
 * Whether the `spectrumBorder` preference is on, and the switch for it (X-006, Settings → Screen → Show Spectrum border). `on` is the value App read at start; the state
 * lives here, as `TimeLeftProvider` keeps Show time left, so the checkbox changes the page at once. The page's side of it is one attribute on `<html>`:
 * **`data-border="off"`** while the border is off and nothing while it is on, which `exzed-art.css` reads (the stripes go, the ground stays the stage's colour). It is written in a
 * layout effect, so a stored "off" is on the page before the first frame is painted and the stripes never flash. With a `store` a change is also written; without one (a
 * test) it only changes.
 */
export function SpectrumBorderProvider({ on, store, children }: { on: boolean; store?: PreferencesStore; children: ReactNode }) {
  const [current, setCurrent] = useState(on)
  const setOn = useCallback(
    (next: boolean) => {
      setCurrent(next)
      if (store) void setSpectrumBorder(store, next)
    },
    [store],
  )
  const value = useMemo<SpectrumBorderValue>(() => ({ on: current, setOn }), [current, setOn])

  useLayoutEffect(() => {
    const root = document.documentElement
    if (current) root.removeAttribute('data-border')
    else root.setAttribute('data-border', 'off')
  }, [current])

  // Only the attribute this component owns, taken off when it goes (the theme's own attributes are, in `DocumentTheme`).
  useLayoutEffect(() => () => document.documentElement.removeAttribute('data-border'), [])

  return <SpectrumBorderContext.Provider value={value}>{children}</SpectrumBorderContext.Provider>
}

/** The setting and its switch: the Settings checkbox uses both. */
export function useSpectrumBorder(): SpectrumBorderValue {
  return useContext(SpectrumBorderContext)
}
