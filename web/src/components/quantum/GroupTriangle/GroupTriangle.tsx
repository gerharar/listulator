import { createContext, useContext, type ReactNode } from 'react'
import './GroupTriangle.css'

const GroupLineContext = createContext(false)

/** Whether the `markOpenGroups` preference is on (App reads it at boot); off for anything not under a provider. */
export function GroupLineProvider({ on, children }: { on: boolean; children: ReactNode }) {
  return <GroupLineContext.Provider value={on}>{children}</GroupLineContext.Provider>
}

/**
 * The triangle at the start of a group head, in a list and in the Preview (canvas H-022). Off (the default) it is the font glyph `.q-chev`
 * as it always was, turned a quarter by its own stylesheets. On, it is a 14 x 12 drawing with a 1px line beside it, both set by the head's
 * `aria-expanded`: a shut group shows ▶ over a line, an open one a line left of ▼, each exactly 6px from the ink. A font glyph has fractional
 * edges that differ by font and platform, so the line could not sit a fixed distance from it; the drawing's edges are whole pixels.
 */
export function GroupTriangle() {
  const line = useContext(GroupLineContext)
  if (!line) {
    return (
      <span className="q-chev" aria-hidden="true">
        ▼
      </span>
    )
  }

  return (
    <span className="q-chev-line" aria-hidden="true">
      <svg className="q-chev-tri" width="14" height="12" viewBox="0 0 14 12" focusable="false">
        <path d="M0 0H14L7 12Z" fill="currentColor" />
      </svg>
      <span className="q-chev-rule" />
    </span>
  )
}
