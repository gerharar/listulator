import { createContext, useCallback, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useDevicePixelRatio } from '../../../lib/useDevicePixelRatio.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { setMarkOpenGroups } from '../../../lib/preferences/groupLine.js'
import './GroupTriangle.css'

interface GroupLineValue {
  on: boolean
  setOn: (on: boolean) => void
  /** The line's thickness in CSS pixels at this screen's scale: a whole number of device pixels (`groupLineThickness`). */
  thickness: number
}

/** Outside a provider (a component alone in a test): off, and nothing to switch. */
const STANDALONE: GroupLineValue = { on: false, setOn: () => {}, thickness: 1 }

/**
 * The line's thickness in CSS pixels at a screen scale, a whole number of device pixels (BL-153: the owner, Windows at 125%). "1px" is 1.25
 * device pixels there, which the screen snaps to 1 pixel row on some group heads and 2 on others (they are 58.75 device pixels apart), so the
 * lines came out unevenly thick. The nearest whole number of device pixels (a tie goes down, so 150% keeps its one row) is the same on every
 * head; at 100%, 200% and 300% it is exactly 1px, the approved look. The meter cells' sizes follow the same rule (1.0.1).
 */
export function groupLineThickness(scale: number): number {
  const ratio = Number.isFinite(scale) && scale > 0 ? scale : 1

  return Math.max(1, Math.ceil(ratio - 0.5)) / ratio
}

const GroupLineContext = createContext<GroupLineValue>(STANDALONE)

/**
 * Whether the `markOpenGroups` preference is on, and the switch for it (H-022). `on` is the value App read at start; the state lives here, as
 * `MotionProvider` keeps Reduce animation motion, so the Settings checkbox redraws every group head at once, in a list and in the Preview.
 * With a `store` a change is also written; without one (a test) it only changes.
 */
export function GroupLineProvider({ on, store, children }: { on: boolean; store?: PreferencesStore; children: ReactNode }) {
  const [current, setCurrent] = useState(on)
  const thickness = groupLineThickness(useDevicePixelRatio())
  const setOn = useCallback(
    (next: boolean) => {
      setCurrent(next)
      if (store) void setMarkOpenGroups(store, next)
    },
    [store],
  )
  const value = useMemo<GroupLineValue>(() => ({ on: current, setOn, thickness }), [current, setOn, thickness])

  return <GroupLineContext.Provider value={value}>{children}</GroupLineContext.Provider>
}

/** The setting and its switch: the Settings checkbox uses both, the drawing only reads `on`. */
export function useGroupLineSetting(): GroupLineValue {
  return useContext(GroupLineContext)
}

/**
 * The triangle at the start of a group head, in a list and in the Preview (canvas H-022). Off (the default) it is the font glyph `.q-chev`
 * as it always was, turned a quarter by its own stylesheets. On, it is a 14 x 12 drawing with a 1px line beside it, both set by the head's
 * `aria-expanded`: a shut group shows ▶ over a line, an open one a line left of ▼, each exactly 6px from the ink. A font glyph has fractional
 * edges that differ by font and platform, so the line could not sit a fixed distance from it; the drawing's edges are whole pixels.
 */
export function GroupTriangle() {
  const { on: line, thickness } = useGroupLineSetting()
  if (!line) {
    return (
      <span className="q-chev" aria-hidden="true">
        ▼
      </span>
    )
  }

  return (
    <span className="q-chev-line" aria-hidden="true" style={{ '--group-line': `${thickness}px` } as CSSProperties}>
      <svg className="q-chev-tri" width="14" height="12" viewBox="0 0 14 12" focusable="false">
        <path d="M0 0H14L7 12Z" fill="currentColor" />
      </svg>
      <span className="q-chev-rule" />
    </span>
  )
}
