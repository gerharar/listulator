/** The in-app lists' tallest (`.q-combo-list`: max-height 220px, plus its 2px gap and border). */
const LIST_HEIGHT = 230

/**
 * Whether a field's in-app list (the Group field's suggestions, the Type/Medium
 * choices) should open above it: when it would run past the window's bottom
 * and there is more room above. The add row sits at the foot of a long list,
 * where a list opening down lands off-screen.
 */
export function opensUp(field: { top: number; bottom: number }, windowHeight: number): boolean {
  const below = windowHeight - field.bottom
  return below < LIST_HEIGHT && field.top > below
}

/** The list's position to open just above the field (not above its label): its bottom 2px over the field's top. */
export function aboveField(field: HTMLElement): { top: 'auto'; bottom: string } {
  return { top: 'auto', bottom: `calc(100% - ${field.offsetTop}px + 2px)` }
}
