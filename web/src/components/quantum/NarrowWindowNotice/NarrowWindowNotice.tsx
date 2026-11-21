import '../Banner/Banner.css'
import { Button } from '../Button/Button.js'
import { copy } from '../../../locale/index.js'
import type { NarrowMode } from '../../../lib/narrowWindow.js'

/**
 * The warning that eX-Zed needs a wider window (Phase 49.12; design’s answers 7 and 8). Never blocking: it says what to do and the app stays usable. `mode` is
 * what the place and the screen allow (`narrowMode`): the button that maximises (the owner’s label, “Embiggen”), the line alone, or the line that asks to widen
 * a browser window. Keep Quantum and Dismiss are always offered; what they do is the shell’s. One banner, whatever made the window narrow (D49, 57.1): the start, a resize,
 * the switch to eX-Zed in Settings. Drawn with Quantum’s Banner, and eX-Zed draws it filled by its own class: it is the one banner that asks for action.
 */
export interface NarrowWindowNoticeProps {
  mode: NarrowMode
  /** The window width eX-Zed needs, for the line that names it. */
  min: number
  onEmbiggen: () => void
  onKeep: () => void
  onDismiss: () => void
}

function line(mode: NarrowMode, min: number): string {
  const text = copy.quantum.narrow

  return mode === 'embiggen' ? text.embiggenLine(min) : mode === 'screen' ? text.screenLine : text.browserLine(min)
}

/** A full-width line under the header, for when eX-Zed is drawn in a window narrower than it needs. */
export function NarrowWindowBanner({ mode, min, onEmbiggen, onKeep, onDismiss }: NarrowWindowNoticeProps) {
  const text = copy.quantum.narrow

  return (
    <div className="q-banner q-banner-narrow" role="status">
      <span>{line(mode, min)}</span>
      <div className="q-banner-actions">
        {mode === 'embiggen' && (
          <Button variant="primary" size="sm" onClick={onEmbiggen}>
            {text.embiggen}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onKeep}>
          {text.keep}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {text.dismiss}
        </Button>
      </div>
    </div>
  )
}
