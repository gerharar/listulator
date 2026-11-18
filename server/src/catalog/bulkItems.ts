import { and, between, eq, sql } from 'drizzle-orm'
import { runAtomically } from '../db/atomic.js'
import type { PortableDatabase } from '../db/client.js'
import { listGroups, listItems, type List, type ListItem } from '../db/schema.js'
import { normalizeItemTags } from './facets.js'
import { groupsOf, seedGroupPositions } from './groups.js'
import { groupPositionStatements } from './orderIndex.js'
import { validMinutes } from './limits.js'
import { validYearPair } from './years.js'
import {
  clearDismissalsStatement,
  createListStatement,
  findList,
  snapshotStatements,
  type CreateListInput,
  type CreateListItemInput,
} from './repository.js'

/**
 * Adding many items to a list in a handful of statements (task 15.9b), where
 * `createListItem` one by one costs three to five queries each, and more as the
 * list grows (DECISIONS "15.0": a 2,161-item build was about 4.5 s flat and 6.5 s
 * grouped through the desktop's SQL plugin, and 10,000 items were out of reach).
 *
 * It must leave exactly the list the sequential path would: the same group made
 * once and spelled as the list spells it, every item at the end of its own group
 * (or of the list, if it has none) with the rows after it moved down, and the
 * same defaults. That is proven by a test that runs random mixes through both.
 */

/**
 * Rows per insert: 3,750 binds at 15 columns, well under SQLite's 32,766, and measured on the desktop
 * (DECISIONS "15.9b"): the cost per row rises steeply with the statement, 90 ms per 1,000 rows at 250 a
 * statement, 156 at 500, 333 at 1,000, 814 at 2,000.
 */
const CHUNK = 250

export type BulkItemInput = Omit<CreateListItemInput, 'orderIndex'>

/** What a source says about one item: a search result, a listing, a stored copy, a refresh's "what's new". */
export interface SourcedItem {
  title: string
  // Null as well: Reset reads them back from stored rows. Empty either way.
  externalRef?: string | null | undefined
  year?: number | null | undefined
  /** Unknown digits of `year` (H-005): only a list file or the user ever has them, never a connector. */
  yearUnk?: number | null | undefined
  group?: string | null | undefined
  tags?: string[] | null | undefined
  notes?: string | null | undefined
  /** A better guess than the category's default when the source has no length (an IGDB DLC). */
  estimatedMinutes?: number | undefined
}

/**
 * A new item from what a source said, one rule for Add list, the import route and Reset (review 2026-10-04: it was
 * written out five times). The length is the source's own when known (`minutes`); otherwise its better guess or
 * the category's default, marked estimated, which is how `time_to_consume_minutes` is never null. Empty values are
 * left out. `source` is `'import'`; a caller that knows better spreads its own over it.
 */
export function itemFromSource(item: SourcedItem, minutes: number | undefined, fallbackMinutes: number): BulkItemInput {
  // Only a length the app can show counts as known (SR-019): a source that says `.nan`, a negative number or `1e308` is
  // treated as not knowing, and the row falls back to an estimate.
  const known = validMinutes(minutes)
  // A year the app cannot show, or unknown digits that do not fit it, count as no year (H-005).
  const year = validYearPair(item.year ?? null, item.yearUnk ?? 0)

  return {
    title: item.title,
    timeToConsumeMinutes: known ?? validMinutes(item.estimatedMinutes) ?? fallbackMinutes,
    timeToConsumeIsEstimated: known === undefined,
    ...(item.externalRef ? { externalRef: item.externalRef } : {}),
    ...(year?.year ? { year: year.year, ...(year.yearUnk ? { yearUnk: year.yearUnk } : {}) } : {}),
    ...(item.group ? { group: item.group } : {}),
    ...(item.tags ? { tags: item.tags } : {}),
    ...(item.notes ? { notes: item.notes } : {}),
    source: 'import',
  }
}

/** One item of a list file, as the parser hands it over. */
export interface FileItem {
  title: string
  year?: number | undefined
  yearUnk?: number | undefined
  minutes?: number | undefined
  group?: string | undefined
  tags?: string[] | undefined
  notes?: string | undefined
}

/**
 * A new item from a list file (pasted, uploaded, dropped in the folder, or from the library): the file's
 * `minutes`, or the category's default marked estimated. Every field the file wrote is kept as written, an empty
 * one too, unlike `itemFromSource`: the file paths always did, and a refactor is not the place to change it.
 */
export function itemFromFile(item: FileItem, defaultMinutes: number): BulkItemInput {
  // The parser refuses a number the app cannot show; this is the same rule at the place the row is made, so a path that
  // never went through the parser cannot write one (SR-019).
  const known = validMinutes(item.minutes)
  const year = validYearPair(item.year ?? null, item.yearUnk ?? 0)

  return {
    title: item.title,
    timeToConsumeMinutes: known ?? defaultMinutes,
    timeToConsumeIsEstimated: known === undefined,
    ...(year?.year ? { year: year.year, ...(year.yearUnk ? { yearUnk: year.yearUnk } : {}) } : {}),
    ...(item.group !== undefined ? { group: item.group } : {}),
    ...(item.tags !== undefined ? { tags: item.tags } : {}),
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
    source: 'import',
  }
}

const chunksOf = <T>(items: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK))

  return out
}

interface Run {
  from: number
  to: number
  by: number
}

/** A row `createListItems` will insert, with the id it will carry (made here, so a clean-up and a result can name it before it exists). */
export type PlannedItemRow = typeof listItems.$inferInsert & { id: string }

/** What adding items to a list comes to, worked out in memory before anything is written. */
export interface ItemWritePlan {
  listId: string
  /** The groups the call makes, in order, with the ids they will carry. */
  newGroups: { id: string; name: string; orderIndex: number }[]
  /** The rows already there that move down, as runs of equal shift, in the order they must be written (highest first, so a run never lands on one still to move). */
  shifts: Run[]
  /** The new rows, in the order given, with the positions they end at. */
  rows: PlannedItemRow[]
}

/**
 * Where `inputs` go in a list that holds `existing` rows and `groups`, as `createListItem` would one by one, worked out without a
 * database: the group made once and spelled as the list spells it, every item straight after its group's last item (or at the end
 * of the list), with everything after it moved down. A rewrite that empties the list first plans against no rows and no groups.
 * Group and item ids are made here.
 */
export function planItemWrites(
  listId: string,
  existing: readonly { orderIndex: number; group: string | null }[],
  groups: readonly { name: string; orderIndex: number }[],
  inputs: readonly BulkItemInput[],
): ItemWritePlan {
  // Group names by their trimmed, lower-cased spelling: the first the list has wins, as `ensureListGroup` finds it.
  const byKey = new Map<string, string>()
  for (const group of groups) {
    const key = group.name.trim().toLowerCase()
    if (!byKey.has(key)) byKey.set(key, group.name)
  }
  let nextGroupOrder = groups.reduce((top, group) => Math.max(top, group.orderIndex), -1) + 1
  const newGroups: ItemWritePlan['newGroups'] = []

  // The list as `placeNewItem` would see it item by item, kept in memory: each row's order number,
  // the highest in each group and in the whole list.
  const orders = existing.map((row) => row.orderIndex)
  const originalOrders = [...orders]
  const groupTop = new Map<string, number>()
  let listTop = -1
  existing.forEach((row, index) => {
    listTop = Math.max(listTop, orders[index]!)
    if (row.group !== null) groupTop.set(row.group, Math.max(groupTop.get(row.group) ?? -1, orders[index]!))
  })

  const placed = inputs.map((input, at) => {
    const label = input.group?.trim()
    let group: string | null = null
    if (label) {
      const key = label.toLowerCase()
      group = byKey.get(key) ?? null
      if (group === null) {
        group = label
        byKey.set(key, label)
        newGroups.push({ id: crypto.randomUUID(), name: label, orderIndex: nextGroupOrder++ })
      }
    }

    // Straight after the group's last item, or at the end of the list for no group or a group with no items yet.
    const top = group === null ? undefined : groupTop.get(group)
    const position = top === undefined ? listTop + 1 : top + 1

    // Everything at or after it moves down one, so the group stays contiguous.
    if (position <= listTop) {
      for (let index = 0; index < orders.length; index += 1) if (orders[index]! >= position) orders[index] = orders[index]! + 1
      for (const [name, value] of groupTop) if (value >= position) groupTop.set(name, value + 1)
      listTop += 1
    }

    orders.push(position)
    if (group !== null) groupTop.set(group, position)
    listTop = Math.max(listTop, position)

    // Its place in `orders`, read at the end: later items may still move it down.
    return { input, group, slot: existing.length + at }
  })

  // The rows already there move by how many items went in before them: runs of equal shift, highest first
  // so a run never lands on one still to move.
  const runs: Run[] = []
  const movers = existing.map((_, index) => index).sort((a, b) => originalOrders[a]! - originalOrders[b]!)
  for (const index of movers) {
    const by = orders[index]! - originalOrders[index]!
    if (by === 0) continue

    const last = runs.at(-1)
    if (last && last.by === by) last.to = originalOrders[index]!
    else runs.push({ from: originalOrders[index]!, to: originalOrders[index]!, by })
  }

  const rows = placed.map(({ input, group, slot }): PlannedItemRow => ({
    id: crypto.randomUUID(),
    listId,
    title: input.title,
    orderIndex: orders[slot]!,
    timeToConsumeMinutes: input.timeToConsumeMinutes,
    timeToConsumeIsEstimated: input.timeToConsumeIsEstimated ?? true,
    externalRef: input.externalRef ?? null,
    source: input.source ?? 'import',
    year: input.year ?? null,
    yearUnk: input.yearUnk ?? 0,
    group,
    tags: normalizeItemTags(input.tags),
    notes: input.notes ?? null,
    isNew: input.isNew ?? false,
  }))

  return { listId, newGroups, shifts: runs.reverse(), rows }
}

const insertGroups = (db: PortableDatabase, listId: string, groups: ItemWritePlan['newGroups']) =>
  db.insert(listGroups).values(groups.map((group) => ({ id: group.id, listId, name: group.name, orderIndex: group.orderIndex })))
const shiftRun = (db: PortableDatabase, listId: string, run: Run) =>
  db
    .update(listItems)
    .set({ orderIndex: sql`${listItems.orderIndex} + ${run.by}` })
    .where(and(eq(listItems.listId, listId), between(listItems.orderIndex, run.from, run.to)))
const insertItems = (db: PortableDatabase, rows: PlannedItemRow[]) => db.insert(listItems).values(rows)
type PlainInsert = ReturnType<typeof insertItems>
const insertItemsReturning = (db: PortableDatabase, rows: PlannedItemRow[]) => insertItems(db, rows).returning()
type ReturningInsert = ReturnType<typeof insertItemsReturning>
interface WriteStatements<Item> {
  groups: ReturnType<typeof insertGroups>[]
  shifts: ReturnType<typeof shiftRun>[]
  items: Item[]
}

/**
 * The statements that carry out a plan, NOT run: the groups, the shifts of the rows already there, the new rows. With `returning` the
 * item inserts hand back the rows they wrote (what `createListItems` returns); without it they hand back nothing (a Reset of 50,000
 * items has no use for them, and they would cross the IPC).
 */
export function itemWriteStatements(db: PortableDatabase, plan: ItemWritePlan, options: { returning: true }): WriteStatements<ReturningInsert>
export function itemWriteStatements(db: PortableDatabase, plan: ItemWritePlan, options: { returning: false }): WriteStatements<PlainInsert>
export function itemWriteStatements(db: PortableDatabase, plan: ItemWritePlan, options: { returning: true }): WriteStatements<ReturningInsert>
export function itemWriteStatements(db: PortableDatabase, plan: ItemWritePlan, options: { returning: false }): WriteStatements<PlainInsert>
export function itemWriteStatements(db: PortableDatabase, plan: ItemWritePlan, { returning }: { returning: boolean }): WriteStatements<PlainInsert | ReturningInsert> {
  const groups = chunksOf(plan.newGroups).map((batch) => insertGroups(db, plan.listId, batch))
  const shifts = plan.shifts.map((run) => shiftRun(db, plan.listId, run))
  const items = chunksOf(plan.rows).map((batch) => {
    return returning ? insertItemsReturning(db, batch) : insertItems(db, batch)
  })

  return { groups, shifts, items }
}

/** What a caller of `createListItems` may ask for in the same transaction. */
export interface AddItemsOptions {
  /** Order the list's groups by the earliest year among their items, as an import does (`seedGroupOrder`), counting the items just added. */
  seedGroupOrder?: boolean
  /** Forget that these items were once deleted (BL-084): adding them back is the user changing their mind. */
  clearDismissalsFor?: { title: string; externalRef?: string | undefined }[]
}

const byPositionThenId = (a: { orderIndex: number; id: string }, b: { orderIndex: number; id: string }) =>
  a.orderIndex - b.orderIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Adds `inputs` to the list, in order, as `createListItem` would one by one.
 * Returns the new rows in the order given, with the positions they ended at;
 * `undefined` when the list is not the user's or not there.
 *
 * All or nothing (Phase 53, 53.5b): what the list holds is read first, the call is planned in memory (`planItemWrites`), and the groups,
 * the shifts of the rows already there, the new rows and whatever `options` asks for run as ONE `runAtomically` list. A failure, or a
 * process that dies, leaves the list exactly as it was; there is no clean-up to run.
 */
export async function createListItems(
  db: PortableDatabase,
  userId: string,
  listId: string,
  inputs: readonly BulkItemInput[],
  options: AddItemsOptions = {},
): Promise<ListItem[] | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const existing = await db
    .select({ orderIndex: listItems.orderIndex, group: listItems.group, year: listItems.year, yearUnk: listItems.yearUnk })
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .all()
  const groups = await groupsOf(db, listId)

  const plan = planItemWrites(listId, existing, groups, inputs)
  const writes = itemWriteStatements(db, plan, { returning: true })
  const clearing = options.clearDismissalsFor ? clearDismissalsStatement(db, listId, options.clearDismissalsFor) : undefined
  const positions = options.seedGroupOrder
    ? seedGroupPositions(
        [...groups.map((group) => ({ id: group.id, name: group.name, orderIndex: group.orderIndex })), ...plan.newGroups].sort(byPositionThenId),
        [
          ...existing.map((row) => ({ group: row.group, year: row.year, yearUnk: row.yearUnk })),
          ...plan.rows.map((row) => ({ group: row.group ?? null, year: row.year ?? null, yearUnk: row.yearUnk ?? null })),
        ],
      )
    : []

  const results = (await runAtomically(db, [
    ...writes.groups,
    ...writes.shifts,
    ...writes.items,
    ...(clearing ? [clearing] : []),
    ...groupPositionStatements(db, listId, positions),
  ])) as unknown[]

  const first = writes.groups.length + writes.shifts.length
  const created = new Map<string, ListItem>()
  for (const rows of results.slice(first, first + writes.items.length) as ListItem[][]) {
    for (const row of rows) created.set(row.id, row)
  }

  return plan.rows.map((row) => created.get(row.id)!)
}

/**
 * Makes a list and everything that arrives with it, in ONE transaction (Phase 53, 53.5b): the list, its groups and items in the order a
 * source or a file gave them, optionally the arrived-state snapshot of those items (D4: what a connector's list is reset to), and the
 * groups ordered by year. All of it or none of it: an import never leaves a half-made list behind, and there is no `discardList` to
 * call. Everything is planned in memory first (nothing is read back: the snapshot is the planned rows as they will stand, the group order
 * is worked out from the plan). The list is read once it has been committed.
 */
export async function createListWithItems(
  db: PortableDatabase,
  userId: string,
  input: CreateListInput,
  inputs: readonly BulkItemInput[],
  { snapshot }: { snapshot: boolean },
): Promise<List> {
  const listId = crypto.randomUUID()
  const plan = planItemWrites(listId, [], [], inputs)
  const writes = itemWriteStatements(db, plan, { returning: false })
  const arrived = [...plan.rows].sort((a, b) => a.orderIndex - b.orderIndex)

  await runAtomically(db, [
    createListStatement(db, userId, input, listId),
    ...writes.groups,
    ...writes.items,
    ...(snapshot
      ? snapshotStatements(
          db,
          listId,
          arrived.map((row) => ({
            title: row.title,
            timeToConsumeMinutes: row.timeToConsumeMinutes,
            timeToConsumeIsEstimated: row.timeToConsumeIsEstimated ?? true,
            orderIndex: row.orderIndex,
            externalRef: row.externalRef ?? null,
            year: row.year ?? null,
            group: row.group ?? null,
            tags: row.tags ?? null,
            notes: row.notes ?? null,
          })),
        )
      : []),
    ...groupPositionStatements(
      db,
      listId,
      seedGroupPositions(
        plan.newGroups,
        plan.rows.map((row) => ({ group: row.group ?? null, year: row.year ?? null, yearUnk: row.yearUnk ?? null })),
      ),
    ),
  ])

  return (await findList(db, userId, listId))!
}
