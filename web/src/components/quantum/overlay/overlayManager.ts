export type OverlayKind = 'popover' | 'sheet'

export interface OverlayEntry {
  id: string
  kind: OverlayKind
  /** Called when this overlay should close — from the Esc ladder, or from a second popover opening. */
  close: () => void
}

export interface OverlayManager {
  register(entry: OverlayEntry): void
  unregister(id: string): void
  topmost(): OverlayEntry | undefined
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
  }
}
