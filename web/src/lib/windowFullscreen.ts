import { useCallback, useEffect, useMemo, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from './platform.js'

/**
 * Full screen for the desktop window (Phase 17, task 17.7; owner's design 2026-10-05): a "Fullscreen" checkbox in
 * Settings and F11, on Windows (which has no full-screen control of its own) and macOS alike. The window is the one
 * source of truth: the checkbox shows what the window is, and the next launch restores what it was at quit
 * (`apps/desktop/src-tauri/src/fullscreen.rs` records every change from the window's resize, whatever caused it),
 * so no setting of its own is stored here.
 */
export interface WindowFullscreen {
  isFullscreen(): Promise<boolean>
  setFullscreen(fullscreen: boolean): Promise<void>
  /** Calls back with the window's state after each resize (entering or leaving full screen resizes it). */
  onChange(listener: (fullscreen: boolean) => void): Promise<() => void>
}

const tauriWindow: WindowFullscreen = {
  isFullscreen: () => getCurrentWindow().isFullscreen(),
  setFullscreen: (fullscreen) => getCurrentWindow().setFullscreen(fullscreen),
  onChange: (listener) =>
    getCurrentWindow().onResized(async () => {
      listener(await getCurrentWindow().isFullscreen())
    }),
}

/** The desktop window's full screen; none in the browser build. */
export function getWindowFullscreen(): WindowFullscreen | undefined {
  return isDesktop() ? tauriWindow : undefined
}

/** `control` is for tests; by default the app's own window, or none outside the desktop app. */
function useControl(control: WindowFullscreen | undefined): WindowFullscreen | undefined {
  return useMemo(() => control ?? getWindowFullscreen(), [control])
}

/** The window's full-screen state, followed live, and a way to set it. */
export function useWindowFullscreen(control?: WindowFullscreen): {
  available: boolean
  fullscreen: boolean
  setFullscreen: (fullscreen: boolean) => void
} {
  const win = useControl(control)
  const [fullscreen, setState] = useState(false)

  useEffect(() => {
    if (!win) return
    let live = true
    void win.isFullscreen().then((current) => live && setState(current))
    const stop = win.onChange((current) => live && setState(current))

    return () => {
      live = false
      void stop.then((unlisten) => unlisten())
    }
  }, [win])

  const setFullscreen = useCallback(
    (next: boolean) => {
      if (!win) return
      setState(next)
      // A refusal (the window could not change) puts the box back to what the window is.
      void win.setFullscreen(next).catch(() => win.isFullscreen().then(setState))
    },
    [win],
  )

  return { available: win !== undefined, fullscreen, setFullscreen }
}

/** F11 toggles full screen; with a modifier it is left alone, and the webview never gets it. Esc is not used. */
export function useFullscreenKey(control?: WindowFullscreen): void {
  const win = useControl(control)

  useEffect(() => {
    if (!win) return

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'F11' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      void win!.isFullscreen().then((current) => win!.setFullscreen(!current))
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [win])
}
