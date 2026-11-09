import { useCallback, useEffect, useState } from 'react'
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
  /** The banner under the header: the app started narrow in eX-Zed and the notice was not dismissed this session. */
  banner: boolean
  /** The popover on the chip: the person has just switched to eX-Zed in a window that is too narrow. */
  popover: boolean
  anchor: HTMLElement | null
  /** The theme changed: to eX-Zed with the chip that was pressed, or away from it with none. */
  opened: (anchor: HTMLElement | null) => void
  embiggen: () => void
  dismiss: () => void
}

/**
 * The narrow-window warning’s state (Phase 49.12). Never blocking, and none of it is stored: Dismiss lasts this session and the stored theme is not touched. A
 * fresh switch to eX-Zed opens the popover again, whatever was dismissed before, because it is a new question. Embiggen is offered once: if the window is still narrow
 * after it worked, the line stays without the button, so the warning never offers what did not work; widening the window resets that.
 */
export function useNarrowWindowNotice({ exzed, width, min, desktop, screenWidth, maximize }: NarrowWindowInputs): NarrowWindowNotice {
  const narrow = exzed && width < min
  const [dismissed, setDismissed] = useState(false)
  const [embiggened, setEmbiggened] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (narrow) return
    setEmbiggened(false)
    setAnchor(null)
  }, [narrow])

  const opened = useCallback((next: HTMLElement | null) => setAnchor(next), [])
  const dismiss = useCallback(() => {
    setDismissed(true)
    setAnchor(null)
  }, [])
  const embiggen = useCallback(() => void maximize().then((done) => done && setEmbiggened(true)), [maximize])

  return {
    narrow,
    mode: narrowMode({ desktop, screenWidth, min, embiggened }),
    banner: narrow && !dismissed && anchor === null,
    popover: narrow && anchor !== null,
    anchor,
    opened,
    embiggen,
    dismiss,
  }
}
