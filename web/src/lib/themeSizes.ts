/**
 * A theme's length, as the page has it (Phase 48.4). Some sizes are drawn by CSS and also needed by TypeScript, which lays the list out in
 * rows of a known height to draw a window of them: the TypeScript reads the same token the CSS does, so the two cannot disagree. `<html>` is
 * where the tokens live (`styles/quantum/tokens.css`, `styles/theme/contract.css`, `exzed.css`), and `html.theme-exzed` must be on it already:
 * `App` puts the class there before the first render, not in an effect after it.
 *
 * Only a plain pixel length is a size: anything else (`auto`, a `calc`, a `rem`, nothing set, no document) is the fallback, which every caller gives
 * as Quantum's value, so a unit test with no stylesheet sees Quantum.
 */
export function tokenPx(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const root = document.documentElement
  // jsdom does not cascade custom properties from inline styles into getComputedStyle; a real browser answers the first.
  const raw = (getComputedStyle(root).getPropertyValue(name) || root.style.getPropertyValue(name)).trim()
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(raw)

  return match ? Number(match[1]) : fallback
}

/** A unitless number token (a scale), the same way: a plain number on `<html>`, `0.959` or `.5` or `1`, else the fallback. */
export function tokenNumber(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const root = document.documentElement
  const raw = (getComputedStyle(root).getPropertyValue(name) || root.style.getPropertyValue(name)).trim()

  return /^-?(\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : fallback
}
