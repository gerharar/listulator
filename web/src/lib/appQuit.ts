import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from './platform.js'

/** What the native side emits when a close or a quit (the window's button, Cmd+Q, Alt+F4) was held back because a run holds it (`close_hold.rs`). */
export const QUIT_WHILE_RUNNING_EVENT = 'quit-while-running'
/** How often the page renews its hold: the native side lets a hold lapse after 20 s, so a page that hangs cannot keep the app from closing. */
export const HOLD_RENEW_MS = 5000

/**
 * Ending the desktop app from its header (task 16.2b; owner's design 2026-10-05): Quit on a Mac, Exit elsewhere.
 * Needed most in full screen, where Windows shows no title bar and so no close button.
 */
export interface AppQuit {
  /** Names the action the way the system does: Quit on macOS, Exit on Windows. */
  platform: 'mac' | 'other'
  quit(): Promise<void>
  /**
   * Asks the native side to hold back the window's own ways of closing (its close button, Cmd+Q, Alt+F4) while a whole-list run goes on
   * (H-015): each is answered with `onQuitWhileRunning` instead. A hold lapses by itself after 20 s unless it is renewed, so a page that hangs
   * cannot make the app impossible to close. `holdClose(false)` before `quit()`, or the quit is held back as well.
   */
  holdClose(held: boolean): Promise<void>
  /** Calls `handler` when a close or quit was held back; resolves to the function that stops listening. */
  onQuitWhileRunning(handler: () => void): Promise<() => void>
}

/** WKWebView's user agent says Macintosh; WebView2's says Windows. No OS plugin needed for one word. */
export function quitPlatform(userAgent: string): AppQuit['platform'] {
  return userAgent.includes('Macintosh') ? 'mac' : 'other'
}

/**
 * The app's own window, or none in the browser build (a tab cannot reliably close itself). Closes the window the way
 * its system close button does, not by ending the process: the window's close events run as usual, so full screen is
 * recorded for the next launch (`fullscreen.rs`), and Tauri ends the app once its last window is gone.
 */
export function getAppQuit(): AppQuit | undefined {
  if (!isDesktop()) return undefined
  return {
    platform: quitPlatform(navigator.userAgent),
    quit: () => getCurrentWindow().close(),
    holdClose: (held) => invoke('hold_close', { held }),
    // On the app's own window, as the isolation hook allows (`apps/desktop/isolation/hook.js`: this event, this target).
    onQuitWhileRunning: (handler) => getCurrentWindow().listen(QUIT_WHILE_RUNNING_EVENT, () => handler()),
  }
}
