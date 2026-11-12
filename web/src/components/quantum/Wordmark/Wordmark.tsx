import './Wordmark.css'

/**
 * The LIST|ULATOR lockup (design-system/components/Wordmark): LIST
 * knocked out of an accent block, ULATOR in ink, set live in type so it
 * re-colours per skin — not the per-skin SVGs in `design-system/assets/
 * Logos/`, which are outlined fallbacks for contexts live type can't
 * reach (an app icon, a document, a slide).
 *
 * Lives at the left of the AppHeader; under eX-Zed it is also the About screen's name, in its large size (`lg`, 32px: design's X-004, the About board).
 */
export function Wordmark({ size }: { size?: 'lg' }) {
  return (
    <span className={size === 'lg' ? 'q-wordmark lg' : 'q-wordmark'} role="img" aria-label="Listulator">
      <b>LIST</b>
      <span>ULATOR</span>
    </span>
  )
}
