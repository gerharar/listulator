import type { ListItem } from '../../lib/api.js'
import type { SpineUnit } from './spine.js'

/**
 * The list screen's rows as a linear model, and which of them to draw (Phase 25, BACKLOG BL-074): a list of thousands draws only the
 * rows in view plus a margin, and stands a spacer of the exact height for the rest, so the scroll bar and the sticky group headers
 * behave as they do when everything is drawn. Pure: no DOM, no React. `windowSlices` answers "draw all of it" (no spacers, the very
 * markup the screen has always had) when virtualization is off, the list is short, or there is no viewport to measure.
 */

/** An item row is 46px (`.q-item`, `Spine.css`); a group header is 47px as rendered. Both are checked against the real page in the e2e. */
export const ITEM_HEIGHT = 46
export const GROUP_HEIGHT = 47

/** From this many rows on, the list is drawn as a window (owner, 2026-10-15; WebKit takes about 0.3 ms a row to redraw, so 200 rows stay under 70 ms). */
export const VIRTUALIZE_FROM = 200

/** `auto` is the default; `off` draws every row of any list (the preference `listVirtualization`). */
export type VirtualizationMode = 'auto' | 'off'

export function shouldVirtualize(rowCount: number, mode: VirtualizationMode): boolean {
  return mode === 'auto' && rowCount >= VIRTUALIZE_FROM
}

/** What the screen has after filtering: a unit (a loose item or a group) and the members of a group that are shown. */
export interface ShownUnit {
  unit: SpineUnit
  members: ListItem[]
}

/** One unit's place: a loose item is one row; a group is its header and, when open, its members. */
export interface ModelUnit {
  key: string
  kind: 'item' | 'group'
  top: number
  height: number
  /** Members drawn when the group is open: zero for a loose item and for a shut group. */
  members: number
}

export interface RowModel {
  units: ModelUnit[]
  /** The whole height of the rows. */
  total: number
  /** Where each row starts, in the list's order: loose items, group headers and open groups' members. */
  rowTops: Map<string, number>
  rowHeights: Map<string, number>
  /** The index of the unit a row belongs to (a member's is its group's). */
  rowUnit: Map<string, number>
}

export function buildRowModel(shown: readonly ShownUnit[], isShut: (groupName: string) => boolean): RowModel {
  const units: ModelUnit[] = []
  const rowTops = new Map<string, number>()
  const rowHeights = new Map<string, number>()
  const rowUnit = new Map<string, number>()
  let top = 0

  shown.forEach(({ unit, members }, index) => {
    if (unit.kind === 'item') {
      const key = unit.item.id
      units.push({ key, kind: 'item', top, height: ITEM_HEIGHT, members: 0 })
      rowTops.set(key, top)
      rowHeights.set(key, ITEM_HEIGHT)
      rowUnit.set(key, index)
      top += ITEM_HEIGHT

      return
    }

    const key = unit.group.id
    const open = !isShut(unit.group.name)
    const count = open ? members.length : 0
    const height = GROUP_HEIGHT + count * ITEM_HEIGHT
    units.push({ key, kind: 'group', top, height, members: count })
    rowTops.set(key, top)
    rowHeights.set(key, GROUP_HEIGHT)
    rowUnit.set(key, index)
    for (let n = 0; n < count; n += 1) {
      const id = members[n]!.id
      rowTops.set(id, top + GROUP_HEIGHT + n * ITEM_HEIGHT)
      rowHeights.set(id, ITEM_HEIGHT)
      rowUnit.set(id, index)
    }
    top += height
  })

  return { units, total: top, rowTops, rowHeights, rowUnit }
}

/** Where a row starts, in pixels from the top of the rows; `undefined` for a row that is not there (filtered out, or in a shut group). */
export function offsetOf(model: RowModel, id: string): number | undefined {
  return model.rowTops.get(id)
}

/** Where a row is, and how much of the top of the viewport is taken from it: a member sits under its group's sticky header. */
function placeOf(model: RowModel, id: string): { top: number; height: number; covered: number } | undefined {
  const top = model.rowTops.get(id)
  const unitIndex = model.rowUnit.get(id)
  if (top === undefined || unitIndex === undefined) return undefined
  const unit = model.units[unitIndex]!

  return { top, height: model.rowHeights.get(id)!, covered: unit.kind === 'group' && unit.key !== id ? GROUP_HEIGHT : 0 }
}

/** The scroll position that puts a row in the middle of the viewport, below its group's sticky header; never above the top. */
export function centreOn(model: RowModel, id: string, viewportHeight: number): number | undefined {
  const place = placeOf(model, id)
  if (!place) return undefined

  return Math.max(0, Math.round(place.top - place.covered - (viewportHeight - place.covered - place.height) / 2))
}

/**
 * The scroll position that shows a row: the one it has when the row is already in view (below the sticky header of its group), the least
 * scroll when the row is less than a viewport away, otherwise the row in the middle. `undefined` for a row that is not there.
 */
export function revealScrollTop(model: RowModel, id: string, scrollTop: number, viewportHeight: number): number | undefined {
  const place = placeOf(model, id)
  if (!place) return undefined
  const bottom = place.top + place.height
  const low = scrollTop + place.covered
  const high = scrollTop + viewportHeight
  if (place.top >= low && bottom <= high) return scrollTop
  if (place.top < low) return low - place.top <= viewportHeight ? Math.max(0, place.top - place.covered) : centreOn(model, id, viewportHeight)

  return bottom - high <= viewportHeight ? bottom - viewportHeight : centreOn(model, id, viewportHeight)
}

/**
 * Where the reader should be after the rows changed (a group folded or opened, a filter, Hide Completed), so that they keep their place.
 * The anchor is the unit at the top of the viewport (the first one whose bottom is below it): it keeps its distance from the top when it is
 * still there. A group that shrank leaves the reader at its last row, a group that was shut at its header; a unit that is gone hands the
 * place to the next one that is left, and with none left the end of the rows. Past the last row (on the Add row) nothing is moved.
 */
export function scrollAfterChange(before: RowModel, after: RowModel, scrollTop: number, viewportHeight: number): number {
  const index = firstEndingAfter(before.units, scrollTop)
  const anchor = before.units[index]
  if (!anchor) return scrollTop

  const still = after.rowUnit.get(anchor.key)
  if (still !== undefined) {
    const unit = after.units[still]!
    const delta = scrollTop - anchor.top
    const room = unit.kind === 'item' ? ITEM_HEIGHT - 1 : unit.members === 0 ? 0 : unit.height - ITEM_HEIGHT

    return unit.top + Math.min(delta, room)
  }

  for (let next = index + 1; next < before.units.length; next += 1) {
    const survivor = after.rowUnit.get(before.units[next]!.key)
    if (survivor !== undefined) return after.units[survivor]!.top
  }

  return Math.max(0, after.total - viewportHeight)
}

/**
 * Where the reader should be so that one unit stays where it is on the screen when the rows change around it: a block is picked up and
 * every group shuts, or put down and they open again. The unit keeps its distance below the top of the view; a header that was stuck at the
 * top (the view was inside its group) stays at the top; never above the top of the list. `undefined` when the unit is not in both models.
 */
export function scrollKeepingUnit(before: RowModel, after: RowModel, key: string, scrollTop: number): number | undefined {
  const was = before.rowUnit.get(key)
  const now = after.rowUnit.get(key)
  if (was === undefined || now === undefined) return undefined
  const below = Math.max(0, before.units[was]!.top - scrollTop)

  return Math.max(0, after.units[now]!.top - below)
}

/** A thing that can be dropped on or moved: a group is its whole box (header and open rows), an item (loose or in a group) is its own row. */
function boxOf(model: RowModel, key: string): { top: number; height: number } | undefined {
  const index = model.rowUnit.get(key)
  if (index === undefined) return undefined
  const unit = model.units[index]!
  if (unit.key === key) return { top: unit.top, height: unit.height }
  const top = model.rowTops.get(key)

  return top === undefined ? undefined : { top, height: model.rowHeights.get(key)! }
}

/**
 * Where the reader should be after something was dropped, so that it lands exactly at the drop line, where the pointer let go (H-009). The
 * line is on the edge of the target's box in the model the drop was made in (a carried group shut, the others as they were): its top for
 * "before", its bottom for "after", never above the list's top edge (so a group whose header is stuck at the top has its line there). A
 * group target is its whole box (the header is only where its top is, not where it sticks); an item target, loose or inside a group, is its
 * own row. After the move re-lays the list, the moved thing's own top (a group's box, not its sticky header; an item's row) is put on that
 * screen position; nothing is rounded to a row, so a short move shifts the view by the row that moved, as the prototype does. `undefined`
 * when the moved thing or its target is not in both models.
 */
export function scrollAfterDrop(
  before: RowModel,
  after: RowModel,
  key: string,
  targetKey: string,
  pos: 'before' | 'after',
  scrollTop: number,
): number | undefined {
  const target = boxOf(before, targetKey)
  const moved = boxOf(after, key)
  if (!target || !moved) return undefined

  const lineOnScreen = Math.max(0, (pos === 'after' ? target.top + target.height : target.top) - scrollTop)

  return Math.max(0, moved.top - lineOnScreen)
}

/** The members of a group that are drawn: runs of member indexes, with a spacer for each gap, in order. */
export type GroupPart = { kind: 'spacer'; height: number } | { kind: 'rows'; from: number; to: number }

export type Slice =
  | { kind: 'spacer'; height: number }
  | { kind: 'item'; unitIndex: number }
  | { kind: 'group'; unitIndex: number; header: true; parts: GroupPart[] }

export interface Viewport {
  scrollTop: number
  height: number
}

export interface WindowOptions {
  /** False draws everything. */
  enabled: boolean
  /** Extra pixels drawn above and below the viewport, so a fast scroll does not show a blank band. */
  overscan: number
  /** Rows that stay drawn wherever they are scrolled (focused, dragged, with an open popover): by row id. */
  pinned: ReadonlySet<string>
}

function wholeList(model: RowModel): Slice[] {
  return model.units.map((unit, unitIndex): Slice =>
    unit.kind === 'item'
      ? { kind: 'item', unitIndex }
      : { kind: 'group', unitIndex, header: true, parts: unit.members > 0 ? [{ kind: 'rows', from: 0, to: unit.members }] : [] },
  )
}

/** The first unit whose bottom is below `y`. */
function firstEndingAfter(units: readonly ModelUnit[], y: number): number {
  let low = 0
  let high = units.length
  while (low < high) {
    const middle = (low + high) >> 1
    const unit = units[middle]!
    if (unit.top + unit.height > y) high = middle
    else low = middle + 1
  }

  return low
}

/** The first unit whose top is at or below `y`. */
function firstStartingAtOrAfter(units: readonly ModelUnit[], y: number): number {
  let low = 0
  let high = units.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (units[middle]!.top >= y) high = middle
    else low = middle + 1
  }

  return low
}

/** What to draw of one group: its members in the window and the pinned ones, with spacers for the rest. */
function groupParts(unit: ModelUnit, low: number, high: number, pinnedMembers: readonly number[]): GroupPart[] {
  if (unit.members === 0) return []
  const base = unit.top + GROUP_HEIGHT
  const from = Math.max(0, Math.floor((low - base) / ITEM_HEIGHT))
  const to = Math.min(unit.members, Math.ceil((high - base) / ITEM_HEIGHT))
  // The window's run and each pinned member, in order, merged where they touch.
  const runs: Array<[number, number]> = []
  const add = (start: number, end: number) => {
    if (end <= start) return
    runs.push([start, end])
  }
  add(from, to)
  for (const index of pinnedMembers) add(index, index + 1)
  runs.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const run of runs) {
    const last = merged[merged.length - 1]
    if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1])
    else merged.push([run[0], run[1]])
  }

  const parts: GroupPart[] = []
  let cursor = 0
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ kind: 'spacer', height: (start - cursor) * ITEM_HEIGHT })
    parts.push({ kind: 'rows', from: start, to: end })
    cursor = end
  }
  if (cursor < unit.members) parts.push({ kind: 'spacer', height: (unit.members - cursor) * ITEM_HEIGHT })

  return parts
}

/**
 * What to draw: the units that touch the viewport (plus the overscan) and the units of the pinned rows, each group as its own
 * block with its header, and spacers of the exact height between them. A group that touches the window always draws its header
 * (it is sticky and must stay mounted while the block is in view); one wholly outside the window is a spacer.
 */
export function windowSlices(model: RowModel, viewport: Viewport | null, options: WindowOptions): Slice[] {
  if (!options.enabled || !viewport || model.units.length === 0) return wholeList(model)

  const scrollTop = Math.min(Math.max(0, viewport.scrollTop), Math.max(0, model.total - viewport.height))
  const low = scrollTop - options.overscan
  const high = scrollTop + viewport.height + options.overscan

  const first = firstEndingAfter(model.units, low)
  const last = firstStartingAtOrAfter(model.units, high) - 1
  const pinnedMembersByUnit = new Map<number, number[]>()
  const mounted = new Set<number>()
  for (let index = first; index <= last; index += 1) mounted.add(index)
  for (const id of options.pinned) {
    const unitIndex = model.rowUnit.get(id)
    if (unitIndex === undefined) continue
    mounted.add(unitIndex)
    const unit = model.units[unitIndex]!
    if (unit.kind === 'group' && unit.key !== id) {
      const member = (model.rowTops.get(id)! - unit.top - GROUP_HEIGHT) / ITEM_HEIGHT
      const list = pinnedMembersByUnit.get(unitIndex) ?? []
      list.push(member)
      pinnedMembersByUnit.set(unitIndex, list)
    }
  }

  const slices: Slice[] = []
  let drawnTo = 0
  for (const unitIndex of [...mounted].sort((a, b) => a - b)) {
    const unit = model.units[unitIndex]!
    if (unit.top > drawnTo) slices.push({ kind: 'spacer', height: unit.top - drawnTo })
    slices.push(
      unit.kind === 'item'
        ? { kind: 'item', unitIndex }
        : { kind: 'group', unitIndex, header: true, parts: groupParts(unit, low, high, pinnedMembersByUnit.get(unitIndex) ?? []) },
    )
    drawnTo = unit.top + unit.height
  }
  if (drawnTo < model.total) slices.push({ kind: 'spacer', height: model.total - drawnTo })

  return slices
}
