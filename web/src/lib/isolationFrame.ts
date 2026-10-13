const FRAME_ID = '__tauri_isolation__'

/**
 * Tauri's isolation pattern holds every call to the backend until its isolation frame says it is ready, and the frame
 * says so from a 50 ms timer (`tauri-utils` `isolation.js`). Tauri hides the frame with `display: none !important`, and
 * Chromium aligns the timers of a hidden cross-origin frame to one-second ticks: the first call went out 0.5 to 0.8 s
 * after the page had started, on every start (measured on the owner's Windows PC, 1.0.1 item 5; reproduced in plain
 * Chrome: `display: none` or off-screen throttled, zero-size, transparent or visible did not).
 *
 * So the frame is made zero-size instead: not drawn, taking no room, out of the tab order and the accessibility tree
 * (`inert`, `aria-hidden`, `tabindex`), and still `sandbox="allow-scripts"` as Tauri made it. Inline `!important` beats
 * Tauri's rule; `style.setProperty` is not blocked by the page's CSP, which only restricts style attributes and
 * `<style>` text the page is parsed from. Tauri adds the frame when the document has loaded, after this has registered,
 * so a `MutationObserver` waits for it (its callback runs right after Tauri's handler, in the same turn).
 */
function adjust(): boolean {
  const frame = document.getElementById(FRAME_ID)
  if (!(frame instanceof HTMLIFrameElement)) return false

  const style = frame.style
  style.setProperty('display', 'block', 'important')
  style.setProperty('position', 'absolute', 'important')
  style.setProperty('width', '0', 'important')
  style.setProperty('height', '0', 'important')
  style.setProperty('border', '0', 'important')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('tabindex', '-1')
  frame.setAttribute('inert', '')

  return true
}

export function keepIsolationFrameAwake(): void {
  if (adjust()) return

  const observer = new MutationObserver(() => {
    if (adjust()) observer.disconnect()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
