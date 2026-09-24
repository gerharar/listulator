import { useMemo, useRef, type ReactNode } from 'react'
import { Router, type Navigator, type To } from 'react-router-dom'

function toPath(to: To): string {
  if (typeof to === 'string') return to
  return `${to.pathname ?? ''}${to.search ?? ''}${to.hash ?? ''}` || '/'
}

export interface LegacyRouteHostProps {
  /** This layer's own, frozen-at-push-time location — what `useParams`/`useLocation` resolve against. */
  path: string
  /** Fired when the hosted screen tries to navigate — never a real history change (D1). */
  onNavigate: (to: string, opts: { replace: boolean }) => void
  children: ReactNode
}

/**
 * Hosts an old, `react-router-dom`-dependent screen inside a layer.
 *
 * A nested `<Router>`/`<BrowserRouter>`/`<MemoryRouter>` throws ("You
 * cannot render a <Router> inside another <Router>") — confirmed
 * empirically, not assumed. So there is no outer `<BrowserRouter>` at all
 * (removed from `main.tsx`); each hosted layer is its own sibling
 * `<Router>`, given a custom `navigator` whose `push`/`replace` call
 * `onNavigate` instead of touching `window.history` — satisfying D1 (no
 * URL sync) by construction, not by convention.
 */
export function LegacyRouteHost({ path, onNavigate, children }: LegacyRouteHostProps) {
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  const navigator = useMemo<Navigator>(
    () => ({
      createHref: (to) => toPath(to),
      go: () => {
        // Browser-style back/forward through a layer's own history does
        // nothing — same as real Back/OS Back doing nothing to the stack (D1).
      },
      push: (to) => onNavigateRef.current(toPath(to), { replace: false }),
      replace: (to) => onNavigateRef.current(toPath(to), { replace: true }),
    }),
    [],
  )

  return (
    <Router location={path} navigator={navigator}>
      {children}
    </Router>
  )
}
