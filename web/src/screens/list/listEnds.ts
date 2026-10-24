/**
 * The two ends of a list (H-019): what takes the reader there (Home and End; the split button in the toolbar and the Preview use the
 * same helpers), which row is there, and where the scroller has to be. Pure, so the list and the Preview share it.
 */
export type ListEnd = 'top' | 'bottom'

export function endForKey(key: string): ListEnd | null {
  if (key === 'Home') return 'top'
  if (key === 'End') return 'bottom'

  return null
}

/** The first or the last row, however many of them are drawn. */
export function endRow<Row>(rows: readonly Row[], end: ListEnd): Row | undefined {
  return end === 'top' ? rows[0] : rows[rows.length - 1]
}

/** The very bottom is the whole height: the browser clamps a position past the end to the last screenful. */
export function endScrollTop(end: ListEnd, scrollHeight: number): number {
  return end === 'top' ? 0 : scrollHeight
}
