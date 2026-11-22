import { useCallback, useEffect, useRef, useState } from 'react'
import { narrowMode, type NarrowMode } from './narrowWindow.js'

/** Everything the notice depends on, given (not read) so each path can be driven in a test, the desktop ones too. */
export interface NarrowWindowInputs {
  /** eX-Zed is the theme drawn: never on a touch-only device, never in Quantum. */
  exzed: boolean
  /** The window’s inner width, the layers’, followed live. */
  width: number
  /** The width eX-Zed needs (`narrowWindowMin`). */
  min: number
  desktop: boolean
  /** What the screen can hold (`screen.availWidth`). */
  screenWidth: number
  /** Maximises the window; `true` when it did. */
  maximize: () => Promise<boolean>
}

export interface NarrowWindowNotice {
  narrow: boolean
  mode: NarrowMode
  /** The banner under the header: eX-Zed is drawn in a window that is too narrow and the notice was not dismissed this session. */
  banner: boolean
  /** The person has just switched to eX-Zed: a fresh question, so the banner asks again whatever was dismissed before. */
  reopen: () => void
  embiggen: () => void
  dismiss: () => void
}

/**
 * The narrow-window warning’s state (Phase 49.12). One banner, whatever made the window narrow: the start, a resize, the switch to eX-Zed in Settings (D49, 57.1;
 * the popover on the chip is gone). Never blocking, and none of it is stored: Dismiss lasts this session and the stored theme is not touched. A fresh switch to eX-Zed
 * shows it again, whatever was dismissed before, because it is a new question. Embiggen is offered once: if the window is still narrow after it worked, the line stays
 * without the button, so the warning never offers what did not work; widening the window resets that.
 */
export function useNarrowWindowNotice({ exzed, width, min, desktop, screenWidth, maximize }: NarrowWindowInputs): NarrowWindowNotice {
  const narrow = exzed && width < min
  const [dismissed, setDismissed] = useState(false)
  const [embiggened, setEmbiggened] = useState(false)
  const narrowNow = useRef(narrow)

  useEffect(() => {
    narrowNow.current = narrow
    if (!narrow) setEmbiggened(false)
  }, [narrow])

  const reopen = useCallback(() => setDismissed(false), [])
  const dismiss = useCallback(() => setDismissed(true), [])
  // The window may already be wide when the maximise reports back (the resize arrives first, and a maximise animates): then there is nothing to remember, or the
  // button would stay gone after the next narrowing. Only a window still narrow once it worked loses the button.
  const embiggen = useCallback(() => void maximize().then((done) => done && narrowNow.current && setEmbiggened(true)), [maximize])

  return {
    narrow,
    mode: narrowMode({ desktop, screenWidth, min, embiggened }),
    banner: narrow && !dismissed,
    reopen,
    embiggen,
    dismiss,
  }
}
