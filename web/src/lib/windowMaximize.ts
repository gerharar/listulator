import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from './platform.js'

/**
 * Maximising the desktop window (Phase 49.11; the owner’s confirmation of `core:window:allow-maximize`, 2026-11-08). The narrow-window warning of eX-Zed (49.12)
 * offers a button where the screen can hold the theme’s minimum width and the window is smaller: it fills the screen, and the window-state plugin brings a
 * maximised window back on the next start. The one call the permission allows: no size, no position, no centre, no un-maximise.
 */
export interface WindowMaximize {
  maximize(): Promise<void>
}

const tauriWindow: WindowMaximize = { maximize: () => getCurrentWindow().maximize() }

/** The desktop window’s control; none in the browser build. */
export function getWindowMaximize(): WindowMaximize | undefined {
  return isDesktop() ? tauriWindow : undefined
}

/**
 * Fills the screen with the window. `true` when it did; `false` where there is no desktop window or the window refused (with a console warning), and never a throw: the warning that
 * asked simply stays, and the person can switch back. `control` is for tests; by default the app’s own window.
 */
export async function maximizeWindow(control: WindowMaximize | undefined = getWindowMaximize()): Promise<boolean> {
  if (!control) return false
  try {
    await control.maximize()

    return true
  } catch (error) {
    // Not silent: a button that does nothing must leave a reason (the isolation hook logs its own refusals; a missing permission is reported here).
    console.warn('[listulator] could not maximise the window:', error)

    return false
  }
}
