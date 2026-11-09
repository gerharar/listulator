/**
 * Whether the device has a pointer that can hover and aim finely (Phase 49.10, design's answer 8): a mouse, a trackpad, a pen on a desktop. eX-Zed is a desktop
 * theme, so a touch-only device (a phone, a tablet with no mouse) renders Quantum and is not offered the theme choice. Read once at boot and followed live, because a
 * mouse can be plugged into a tablet while the app runs. A browser that cannot say counts as having one: the desktop is the default, so nothing is hidden by accident.
 */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)'

export function finePointer(): boolean {
  return typeof matchMedia === 'function' ? matchMedia(FINE_POINTER_QUERY).matches : true
}

/** Calls `listener` with the new answer whenever the device’s pointer capability changes; returns the way to stop. */
export function subscribeFinePointer(listener: (fine: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(FINE_POINTER_QUERY)
  const onChange = (event: { matches: boolean }) => listener(event.matches)
  query.addEventListener('change', onChange)

  return () => query.removeEventListener('change', onChange)
}
