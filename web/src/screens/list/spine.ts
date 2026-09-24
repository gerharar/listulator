import type { ListGroup, ListItem } from '../../lib/api.js'

export interface YearSpan {
  from: number
  to: number
}

/** A group and the items inside it, with its own progress. */
export interface GroupBlock {
  kind: 'group'
  group: ListGroup
  items: ListItem[]
  done: number
  total: number
  minutesLeft: number
  yearSpan: YearSpan | null
  /** Items, and every one of them done — an empty group is never "all done". */
  allDone: boolean
}

export interface LooseItem {
  kind: 'item'
  item: ListItem
}

export type SpineUnit = GroupBlock | LooseItem

export interface ListTotals {
  done: number
  total: number
  minutesLeft: number
}

export function listTotals(items: readonly ListItem[]): ListTotals {
  let done = 0
  let minutesLeft = 0

  for (const item of items) {
    if (item.consumedAt !== null) done += 1
    else minutesLeft += item.timeToConsumeMinutes
  }

  return { done, total: items.length, minutesLeft }
}

function spanOf(items: readonly ListItem[]): YearSpan | null {
  const years = items.map((item) => item.year).filter((year): year is number => year !== null)

  return years.length > 0 ? { from: Math.min(...years), to: Math.max(...years) } : null
}

/** `(2019–2021)`, `(2019)`, or nothing. */
export function yearSpanLabel(span: YearSpan | null): string | null {
  if (!span) return null

  return span.from === span.to ? `(${span.from})` : `(${span.from}–${span.to})`
}

/**
 * The list as the screen lays it out: ungrouped items on their own, and each
 * group as one block.
 *
 * The items' own order is the truth (a group reorder renumbers them, so the
 * two never disagree): a block sits where its first item is, and takes every
 * item of that group with it. Groups with no items at all come last, in the
 * list's group order — an empty group "sits at the end of the spine".
 * `groups` decides which groups exist; an item whose label has no group row
 * still gets a block rather than vanishing.
 */
export function buildSpine(items: readonly ListItem[], groups: readonly ListGroup[]): SpineUnit[] {
  const ordered = [...items].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
  const known = new Map(groups.map((group) => [group.name, group]))

  const byLabel = new Map<string, ListItem[]>()
  for (const entry of ordered) {
    if (entry.group) byLabel.set(entry.group, [...(byLabel.get(entry.group) ?? []), entry])
  }

  const blockFor = (group: ListGroup, members: ListItem[]): GroupBlock => {
    const totals = listTotals(members)

    return {
      kind: 'group',
      group,
      items: members,
      ...totals,
      yearSpan: spanOf(members),
      allDone: totals.total > 0 && totals.done === totals.total,
    }
  }

  const units: SpineUnit[] = []
  const emitted = new Set<string>()

  for (const entry of ordered) {
    if (!entry.group) {
      units.push({ kind: 'item', item: entry })
      continue
    }
    if (emitted.has(entry.group)) continue

    emitted.add(entry.group)
    const group = known.get(entry.group) ?? {
      id: `label:${entry.group}`,
      listId: entry.listId,
      name: entry.group,
      orderIndex: Number.MAX_SAFE_INTEGER,
    }
    units.push(blockFor(group, byLabel.get(entry.group)!))
  }

  for (const group of [...groups].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (!emitted.has(group.name)) units.push(blockFor(group, []))
  }

  return units
}
