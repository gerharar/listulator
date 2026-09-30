/** Input types whose right-click menu is worth keeping: the ones you type into. */
const TYPING = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''])

function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('textarea, [contenteditable=""], [contenteditable="true"]')) return true
  const input = target.closest('input')

  return input !== null && TYPING.has((input.getAttribute('type') ?? '').toLowerCase())
}

/**
 * The app is not a web page: a right-click on its buttons, rows and icons must not open the browser's
 * own menu (Back, Reload, Inspect Element…). Typing fields keep it, for cut, copy and paste. In the
 * desktop app's development build "Inspect Element" would still show inside a field. Returns the
 * function that removes the guard.
 */
export function installContextMenuGuard(doc: Document = document): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (!typesText(event.target)) event.preventDefault()
  }
  doc.addEventListener('contextmenu', onContextMenu)

  return () => doc.removeEventListener('contextmenu', onContextMenu)
}
