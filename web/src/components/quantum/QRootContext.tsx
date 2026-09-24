import { createContext, useContext, useState, type ReactNode } from 'react'

// `undefined` (no provider at all — e.g. a component rendered standalone in
// a test) means "there is no `.q-root` to wait for, use the normal default
// (`document.body`)". `null` (a real `QRoot` exists but hasn't attached its
// ref yet) means "wait" — `FloatingPortal` treats an explicit `root: null`
// as "defer portal creation" rather than falling back, so collapsing that
// distinction to a single `null` default broke every Popover test that
// doesn't wrap in `QRoot` (found by hand in a real browser, then here).
const QRootElementContext = createContext<HTMLElement | null | undefined>(undefined)

export interface QRootProps {
  /** The active skin — becomes `data-theme`, which is what every generated token block keys off. */
  skin: string
  children: ReactNode
}

/**
 * The single `.q-root` element every Quantum CSS custom property is scoped
 * under (D9). Anything that portals — `Popover`'s `FloatingPortal`, first —
 * must render *inside* this element, not `document.body`: a portal to
 * `document.body` sits outside `.q-root`'s subtree, so `var(--card)` etc.
 * resolve to nothing there and the portaled content renders unstyled
 * (found by hand in a real browser — jsdom never applies CSS, so no test
 * catches this). `useQRootElement()` is how a portal finds its way back in.
 */
export function QRoot({ skin, children }: QRootProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)

  return (
    <div className="q-root" data-theme={skin} ref={setElement}>
      <QRootElementContext.Provider value={element}>{children}</QRootElementContext.Provider>
    </div>
  )
}

/**
 * `undefined` outside any `QRoot` (portal to `document.body` as normal);
 * `null` briefly while a real `QRoot` exists but hasn't attached its ref
 * yet (wait — don't portal to `document.body`, it would render unstyled).
 */
export function useQRootElement(): HTMLElement | null | undefined {
  return useContext(QRootElementContext)
}
