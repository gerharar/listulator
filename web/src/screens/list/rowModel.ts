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
