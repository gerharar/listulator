import { useEffect, type RefObject } from 'react'

/**
 * While `open`, a press anywhere outside `field` closes it and does nothing
 * else, as a Popover's catcher does (owner: every picker behaves so). The
 * press is cancelled and stopped, and the click after it swallowed; the
 * swallower is dropped just after the release, so a press that never became
 * a click (a drag) cannot eat a later one (a key's click). Document listeners,
 * not a catcher element: inside the Edit window a catcher would share the
 * window's stacking layer and cover the list itself. Also why it does not rely
 * on blur: WebKit (the desktop app) never focuses a clicked button.
 */
export function useDismissOnPress(open: boolean, field: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return

    const swallowClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      document.removeEventListener('click', swallowClick, true)
    }
    const onRelease = () => {
      document.removeEventListener('pointerup', onRelease, true)
      setTimeout(() => document.removeEventListener('click', swallowClick, true))
    }
    const onPress = (event: PointerEvent) => {
      if (event.target instanceof Node && field.current?.contains(event.target)) return
      event.preventDefault() // no focus move, no mouse events after it
      event.stopPropagation()
      document.addEventListener('click', swallowClick, true)
      document.addEventListener('pointerup', onRelease, true)
      close()
    }

    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [open, field, close])
}
