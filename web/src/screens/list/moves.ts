import type { ListGroup, ListItem, OrderRestore } from '../../lib/api.js'
import { buildSpine, type SpineUnit } from './spine.js'

/**
 * Moving things on the list screen (design rules, "Moving things"; the
 * prototype's `spineDrop` / `spineStep` / `dropItem` / `move`). Pure: each
 * function takes the list as it stands and says which positions would change,
 * and what to put back to undo it. Dragging and Shift+↑↓ go through the same
 * two functions per kind of row, so they cannot save different orders.
 *
 * The list is a spine of blocks: a group is one block (its items in their own
 * order) and every loose item is a block of its own. A group and a loose item
 * move as blocks among blocks; an item that belongs to a group moves only
 * within it (moving it to another group is the item popover's job). Empty
 * groups always sit last and take no part.
 */

export type MoveOutcome =
  | {
      kind: 'moved'
      /** The positions to send (only what changed) and the ones that undo it. */
      next: OrderRestore
      previous: OrderRestore
      /** The rows to pulse: the moved ones (a group's own id and its items'). */
      pulseIds: string[]
      title: string
      /** Where it now stands among its peers: blocks on the list, or the items of its group. */
      position: number
      total: number
      /** Set when it moved inside a group. */
      groupName?: string
    }
  | { kind: 'edge'; side: 'top' | 'bottom'; groupName?: string }
  /** Dropped somewhere it already is, or on nothing. */
  | { kind: 'none' }
  /** An item dropped on another group: only the item popover does that. */
  | { kind: 'refused' }

/** The key a block goes by: a group's own id, or a loose item's. */
export function unitKey(unit: SpineUnit): string {
  return unit.kind === 'item' ? unit.item.id : unit.group.id
}

/** Blocks that can move: every loose item and every group that has items. */
function movable(items: readonly ListItem[], groups: readonly ListGroup[]) {
  const all = buildSpine(items, groups)

  return {
    all,
    blocks: all.filter((unit) => unit.kind === 'item' || unit.items.length > 0),
  }
}

/** The items and group rows with the given positions written in. */
export function applyPositions(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  positions: OrderRestore,
): { items: ListItem[]; groups: ListGroup[] } {
  const itemAt = new Map(positions.items.map((entry) => [entry.id, entry.orderIndex]))
  const groupAt = new Map(positions.groups.map((entry) => [entry.id, entry.orderIndex]))

  return {
    items: items.map((entry) => (itemAt.has(entry.id) ? { ...entry, orderIndex: itemAt.get(entry.id)! } : entry)),
    groups: groups.map((entry) => (groupAt.has(entry.id) ? { ...entry, orderIndex: groupAt.get(entry.id)! } : entry)),
  }
}

function change(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  itemIndexes: ReadonlyMap<string, number>,
  groupIndexes: ReadonlyMap<string, number>,
): { next: OrderRestore; previous: OrderRestore } {
  const next: OrderRestore = { items: [], groups: [] }
  const previous: OrderRestore = { items: [], groups: [] }

  for (const entry of items) {
    const to = itemIndexes.get(entry.id)
    if (to !== undefined && to !== entry.orderIndex) {
      next.items.push({ id: entry.id, orderIndex: to })
      previous.items.push({ id: entry.id, orderIndex: entry.orderIndex })
    }
  }
  for (const entry of groups) {
    const to = groupIndexes.get(entry.id)
    if (to !== undefined && to !== entry.orderIndex) {
      next.groups.push({ id: entry.id, orderIndex: to })
      previous.groups.push({ id: entry.id, orderIndex: entry.orderIndex })
    }
  }

  return { next, previous }
}

/** Blocks in a new order → the whole list renumbered to match, with only the differences kept. */
function reorderBlocks(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  order: readonly SpineUnit[],
  emptyGroups: readonly SpineUnit[],
  moved: SpineUnit,
): MoveOutcome {
  const itemIndexes = new Map<string, number>()
  let index = 0
  for (const unit of order) {
    if (unit.kind === 'item') itemIndexes.set(unit.item.id, index++)
    else for (const member of unit.items) itemIndexes.set(member.id, index++)
  }

  const known = new Set(groups.map((entry) => entry.id))
  const groupIndexes = new Map<string, number>()
  let groupIndex = 0
  for (const unit of [...order, ...emptyGroups]) {
    if (unit.kind === 'group' && known.has(unit.group.id)) groupIndexes.set(unit.group.id, groupIndex++)
  }

  const { next, previous } = change(items, groups, itemIndexes, groupIndexes)
  if (next.items.length === 0 && next.groups.length === 0) return { kind: 'none' }

  return {
    kind: 'moved',
    next,
    previous,
    pulseIds: moved.kind === 'item' ? [moved.item.id] : [moved.group.id, ...moved.items.map((member) => member.id)],
    title: moved.kind === 'item' ? moved.item.title : moved.group.name,
    position: order.indexOf(moved) + 1,
    total: order.length,
  }
}

/** Drop a block before or after another block. */
export function dropUnit(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  key: string,
  targetKey: string,
  pos: 'before' | 'after',
): MoveOutcome {
  if (key === targetKey) return { kind: 'none' }
  const { all, blocks } = movable(items, groups)
  const moved = blocks.find((unit) => unitKey(unit) === key)
  if (!moved || !blocks.some((unit) => unitKey(unit) === targetKey)) return { kind: 'none' }

  const rest = blocks.filter((unit) => unit !== moved)
  const at = rest.findIndex((unit) => unitKey(unit) === targetKey) + (pos === 'after' ? 1 : 0)
  const order = [...rest.slice(0, at), moved, ...rest.slice(at)]

  return reorderBlocks(items, groups, order, all.filter((unit) => !blocks.includes(unit)), moved)
}

/** Shift+↑↓ on a block: one block up or down, or the edge. */
export function stepUnit(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  key: string,
  dir: -1 | 1,
): MoveOutcome {
  const { blocks } = movable(items, groups)
  const from = blocks.findIndex((unit) => unitKey(unit) === key)
  if (from < 0) return { kind: 'none' }

  const neighbour = blocks[from + dir]
  if (!neighbour) return { kind: 'edge', side: dir < 0 ? 'top' : 'bottom' }

  return dropUnit(items, groups, key, unitKey(neighbour), dir < 0 ? 'before' : 'after')
}

function peersOf(items: readonly ListItem[], name: string): ListItem[] {
  return items.filter((entry) => entry.group === name).sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
}

/**
 * Drop an item before or after another. A loose item moves as a block among
 * blocks; one that belongs to a group only moves inside it, reusing the slots
 * the group's items already hold (so nothing else in the list moves).
 */
export function dropItemInGroup(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  itemId: string,
  targetId: string,
  pos: 'before' | 'after',
): MoveOutcome {
  const dragged = items.find((entry) => entry.id === itemId)
  const target = items.find((entry) => entry.id === targetId)
  if (!dragged || !target || dragged.id === target.id) return { kind: 'none' }

  if (!dragged.group && !target.group) return dropUnit(items, groups, itemId, targetId, pos)
  if (dragged.group !== target.group) return { kind: 'refused' }

  const name = dragged.group!
  const peers = peersOf(items, name)
  const slots = peers.map((entry) => entry.orderIndex)
  const rest = peers.filter((entry) => entry.id !== itemId)
  const at = rest.findIndex((entry) => entry.id === targetId) + (pos === 'after' ? 1 : 0)
  const sequence = [...rest.slice(0, at), dragged, ...rest.slice(at)]

  const indexes = new Map(sequence.map((entry, index) => [entry.id, slots[index]!] as const))
  const { next, previous } = change(items, groups, indexes, new Map())
  if (next.items.length === 0) return { kind: 'none' }

  return {
    kind: 'moved',
    next,
    previous,
    pulseIds: [itemId],
    title: dragged.title,
    position: sequence.indexOf(dragged) + 1,
    total: sequence.length,
    groupName: name,
  }
}

/** Shift+↑↓ on an item: inside its group, or as a block when it is loose. */
export function stepItemInGroup(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  itemId: string,
  dir: -1 | 1,
): MoveOutcome {
  const entry = items.find((candidate) => candidate.id === itemId)
  if (!entry) return { kind: 'none' }
  if (!entry.group) return stepUnit(items, groups, itemId, dir)

  const peers = peersOf(items, entry.group)
  const from = peers.findIndex((candidate) => candidate.id === itemId)
  const neighbour = peers[from + dir]
  if (!neighbour) return { kind: 'edge', side: dir < 0 ? 'top' : 'bottom', groupName: entry.group }

  return dropItemInGroup(items, groups, itemId, neighbour.id, dir < 0 ? 'before' : 'after')
}

/**
 * Shift+↑↓ while a filter hides rows. The neighbour is the next row that is
 * *shown*, and the row goes just past it: what a drop next to that row would
 * do, so a step never appears to do nothing because of what is hidden.
 * `isShown` answers for item ids and group ids alike.
 */
export function stepAmongShown(
  items: readonly ListItem[],
  groups: readonly ListGroup[],
  key: string,
  dir: -1 | 1,
  isShown: (id: string) => boolean,
): MoveOutcome {
  const entry = items.find((candidate) => candidate.id === key)

  if (entry?.group) {
    const peers = peersOf(items, entry.group).filter((peer) => peer.id === key || isShown(peer.id))
    const neighbour = peers[peers.findIndex((peer) => peer.id === key) + dir]
    if (!neighbour) return { kind: 'edge', side: dir < 0 ? 'top' : 'bottom', groupName: entry.group }

    return dropItemInGroup(items, groups, key, neighbour.id, dir < 0 ? 'before' : 'after')
  }

  const blocks = movable(items, groups).blocks.filter((unit) => unitKey(unit) === key || isShown(unitKey(unit)))
  const from = blocks.findIndex((unit) => unitKey(unit) === key)
  if (from < 0) return { kind: 'none' }

  const neighbour = blocks[from + dir]
  if (!neighbour) return { kind: 'edge', side: dir < 0 ? 'top' : 'bottom' }

  return dropUnit(items, groups, key, unitKey(neighbour), dir < 0 ? 'before' : 'after')
}
