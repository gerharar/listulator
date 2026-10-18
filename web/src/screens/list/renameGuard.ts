/**
 * A click away from a group's name field only ends the rename (H-013): it saves, or keeps the field open with its message when the name is taken,
 * and it never also presses what it landed on (a chip, Hide Completed, a checkbox, another group's chevron), as a click on a popover's backdrop
 * does not. A backdrop is not used: the sticky group headers make its z-order unreliable, and this has no layering to get wrong. The press is
 * swallowed in the capture phase, before React or anything else sees it; the field is blurred, which is what commits; and the rest of the same
 * gesture (the matching mouse press, `pointerup`, `mouseup`, `click`, `dragstart`) is eaten too. The wheel and the trackpad are not touched.
 */

/** A press that never becomes a click (a touch that scrolled, a drag that left the window) stops being eaten after this long. */
const GESTURE_END_MS = 100

const DOWN = ['pointerdown', 'mousedown'] as const
const REST = ['pointerup', 'mouseup', 'click', 'dragstart'] as const

export interface RenameGuard {
  /** The rename is over. Whatever press is being eaten goes on being eaten until it ends; then the listeners go. */
  release: () => void
}

/**
 * `field` is the open name field; `isInside` says a press on it, or on its refusal message under the header, is the rename's own and left alone.
 */
export function guardRename(field: () => HTMLElement | null, isInside: (target: Node | null) => boolean): RenameGuard {
  let eating = false
  let released = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const stopEating = () => {
    eating = false
    clearTimeout(timer)
    if (released) remove()
  }

  const onDown = (event: Event) => {
    // A second `pointerdown` while one is being eaten is a new press: the first one's release never arrived (it ended outside the window), and
    // it must not take the next real press with it. (A `mousedown` after the `pointerdown` is the same press: it is eaten.)
    if (eating && event.type === 'pointerdown') stopEating()
    if (eating) {
      swallow(event)
      return
    }
    if (released) {
      remove()
      return
    }
    const input = field()
    if (!input || isInside(event.target as Node | null)) return

    swallow(event)
    eating = true
    // The blur is what commits (as Enter would); a taken name puts the cursor back in the field.
    input.blur()
  }

  const onRest = (event: Event) => {
    if (!eating) return
    swallow(event)
    if (event.type === 'click') stopEating()
    // A click normally follows the pointer's release at once; when none does, the gesture was not a click.
    else if (event.type === 'pointerup' || event.type === 'pointercancel') {
      clearTimeout(timer)
      timer = setTimeout(stopEating, GESTURE_END_MS)
    }
  }

  const onCancel = () => {
    if (!eating) return
    clearTimeout(timer)
    timer = setTimeout(stopEating, GESTURE_END_MS)
  }

  function remove() {
    for (const type of DOWN) window.removeEventListener(type, onDown, true)
    for (const type of REST) window.removeEventListener(type, onRest, true)
    window.removeEventListener('pointercancel', onCancel, true)
    clearTimeout(timer)
  }

  for (const type of DOWN) window.addEventListener(type, onDown, true)
  for (const type of REST) window.addEventListener(type, onRest, true)
  window.addEventListener('pointercancel', onCancel, true)

  return {
    release() {
      released = true
      if (!eating) remove()
    },
  }
}
