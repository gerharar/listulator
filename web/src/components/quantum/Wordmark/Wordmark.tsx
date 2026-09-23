import './Wordmark.css'

/**
 * The LIST|ULATOR lockup (design-system/components/Wordmark): LIST
 * knocked out of an accent block, ULATOR in ink, set live in type so it
 * re-colours per skin — not the per-skin SVGs in `design-system/assets/
 * Logos/`, which are outlined fallbacks for contexts live type can't
 * reach (an app icon, a document, a slide).
 *
 * Lives at the left of the AppHeader, and nowhere else in the app.
 */
export function Wordmark() {
  return (
    <span className="q-wordmark" role="img" aria-label="Listulator">
      <b>LIST</b>
      <span>ULATOR</span>
    </span>
  )
}
