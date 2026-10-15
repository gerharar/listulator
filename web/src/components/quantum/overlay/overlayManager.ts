export type OverlayKind = 'popover' | 'sheet'

export interface OverlayEntry {
  id: string
  kind: OverlayKind
  /** Called when this overlay should close — from the Esc ladder, or from a second popover opening. */
  close: () => void
}

/**
 * A layer's own rung of the Esc ladder (H-008: a list's filter text): after the popovers, before the layer is popped,
 * Esc runs the topmost step. A step is registered only while it has something to undo.
 */
export interface EscStep {
  id: string
  run: () => void
}

export interface OverlayManager {
  register(entry: OverlayEntry): void
  unregister(id: string): void
  topmost(): OverlayEntry | undefined
  registerStep(step: EscStep): void
  unregisterStep(id: string): void
  topmostStep(): EscStep | undefined
}

/**
 * The stack behind "only one popover is open at a time" and the Esc ladder
 * (design-system README, Overlays section). A popover and a sheet can be
 * open together — the one-at-a-time rule is popover-only, since a sheet's
 * helper content can itself open a popover (design-system/components/Popover).
 *
 * Framework-agnostic on purpose: a `Popover`/`Sheet` component registers
 * itself in a `useEffect` and unregisters on unmount, so this stays testable
 * without any rendering harness.
 */
export function createOverlayManager(): OverlayManager {
  let stack: OverlayEntry[] = []
  let steps: EscStep[] = []

  return {
    register(entry) {
      if (entry.kind === 'popover') {
        for (const existing of stack) {
          if (existing.kind === 'popover' && existing.id !== entry.id) {
            existing.close()
          }
        }
      }
      stack = stack.filter((existing) => existing.id !== entry.id)
      stack.push(entry)
    },
    unregister(id) {
      stack = stack.filter((existing) => existing.id !== id)
    },
    topmost() {
      return stack[stack.length - 1]
    },
    registerStep(step) {
      steps = steps.filter((existing) => existing.id !== step.id)
      steps.push(step)
    },
    unregisterStep(id) {
      steps = steps.filter((existing) => existing.id !== id)
    },
    topmostStep() {
      return steps[steps.length - 1]
    },
  }
}
