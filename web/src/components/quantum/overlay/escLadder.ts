import type { OverlayManager } from './overlayManager.js'

/**
 * Esc closes the topmost popover or sheet first; then runs the topmost step a layer registered for itself (H-008: the
 * list filter's text is cleared before the list closes); only once nothing is open
 * does it fall through to popping a layer (design-system README, Overlays
 * section — "Esc closes the topmost popover, then pops the layer").
 * `popLayer` is a caller-supplied hook rather than a hard LayerStack
 * dependency — the stack itself doesn't land until 10.9.
 */
export function handleEscape(manager: OverlayManager, popLayer: () => void): void {
  const topmost = manager.topmost()
  if (topmost) {
    topmost.close()
    return
  }
  const step = manager.topmostStep()
  if (step) step.run()
  else popLayer()
}
