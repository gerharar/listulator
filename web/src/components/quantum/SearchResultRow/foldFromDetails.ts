import type { MouseEvent } from 'react'

/**
 * Whether a click in an open result's details folds the row (the details and the title row are one tinted block):
 * anywhere but a button or a link, and not when the click ends a text selection, so the description can be copied.
 * Shared by the result row and the cross-category hint row.
 */
export function shouldFoldFromDetails(event: MouseEvent): boolean {
  if ((event.target as HTMLElement).closest('button, a')) return false

  return !window.getSelection()?.toString()
}
