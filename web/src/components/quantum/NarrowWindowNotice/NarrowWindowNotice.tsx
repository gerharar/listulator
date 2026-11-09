import '../Banner/Banner.css'
import { Button } from '../Button/Button.js'
import { Popover } from '../Popover/Popover.js'
import { copy } from '../../../locale/index.js'
import type { NarrowMode } from '../../../lib/narrowWindow.js'

/**
 * The warning that eX-Zed needs a wider window (Phase 49.12; design’s answers 7 and 8). Never blocking: it says what to do and the app stays usable. `mode` is
 * what the place and the screen allow (`narrowMode`): the button that maximises (the owner’s label, “Embiggen”), the line alone, or the line that asks to widen
 * a browser window. Keep Quantum and Dismiss are always offered; what they do is the shell’s. Drawn with Quantum’s Banner and Popover, themed by the tokens: eX-Zed’s own
 * drawing of both is X-007’s.
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

/** A full-width line under the header, for when the app started in eX-Zed in a window narrower than it needs. */
export function NarrowWindowBanner({ mode, min, onEmbiggen, onKeep, onDismiss }: NarrowWindowNoticeProps) {
  const text = copy.quantum.narrow

  return (
    <div className="q-banner" role="status">
      <span>{line(mode, min)}</span>
      <div className="q-banner-actions">
        {mode === 'embiggen' && (
          <Button variant="secondary" size="sm" onClick={onEmbiggen}>
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

/** The same warning as a popover on the eX-Zed chip, for when the person has just switched to it in a window that is too narrow. */
export function NarrowWindowPopover({ open, anchorEl, mode, min, onEmbiggen, onKeep, onDismiss }: NarrowWindowNoticeProps & { open: boolean; anchorEl: HTMLElement | null }) {
  const text = copy.quantum.narrow

  return (
    <Popover open={open} anchorEl={anchorEl} onDismiss={onDismiss} width={360} label={text.kicker}>
      <div className="q-pop-head">
        <span className="q-kicker">{text.kicker}</span>
      </div>
      <span className="q-pop-note">{line(mode, min)}</span>
      <div className="q-pop-actions">
        <Button variant="quiet" onClick={onDismiss}>
          {text.dismiss}
        </Button>
        <Button variant="quiet" onClick={onKeep}>
          {text.keep}
        </Button>
        {mode === 'embiggen' && (
          <Button variant="primary" onClick={onEmbiggen}>
            {text.embiggen}
          </Button>
        )}
      </div>
    </Popover>
  )
}
