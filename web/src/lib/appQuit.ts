import { getCurrentWindow } from '@tauri-apps/api/window'
import { isDesktop } from './platform.js'

/**
 * Ending the desktop app from its header (task 16.2b; owner's design 2026-10-05): Quit on a Mac, Exit elsewhere.
 * Needed most in full screen, where Windows shows no title bar and so no close button.
 */
export interface AppQuit {
  /** Names the action the way the system does: Quit on macOS, Exit on Windows. */
  platform: 'mac' | 'other'
  quit(): Promise<void>
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
  return { platform: quitPlatform(navigator.userAgent), quit: () => getCurrentWindow().close() }
}
