import type { RowModel } from './rowModel.js'

/**
 * The drop line of a group taller than the view can be off screen (H-014): "before" is on the group's own top, which is above the view while
 * its header is stuck; "after" is under its last row, below the view. Then the line is pinned to the edge of the list nearest the real one,
 * with a label. This answers which edge, or `null` when the real line is on screen (it shows as it always does) or the group cannot have the
 * problem: a collapsed or empty group, a loose item and a row inside a group never pin, and neither does a group that fits in the view.
 * Measured on the row model, never the DOM: the group's rows may not be drawn.
 */
export type PinEdge = 'top' | 'bottom'

export function dropPinEdge(model: RowModel, over: { key: string; pos: 'before' | 'after' }, scrollTop: number, viewportHeight: number): PinEdge | null {
  const index = model.rowUnit.get(over.key)
  const unit = index === undefined ? undefined : model.units[index]
  if (!unit || unit.kind !== 'group' || unit.key !== over.key || unit.members === 0) return null
  if (unit.height <= viewportHeight) return null

  if (over.pos === 'before') return unit.top < scrollTop ? 'top' : null

  return unit.top + unit.height > scrollTop + viewportHeight ? 'bottom' : null
}
