import { and, between, eq, inArray, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { listGroups, listItems, lists, type ListItem } from '../db/schema.js'
import { normalizeItemTags } from './facets.js'
import { groupsOf } from './groups.js'
import { findList, type CreateListItemInput } from './repository.js'

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

/** Rows per insert: under SQLite's 32,766 binds at 15 columns, and the size that is quickest through the desktop plugin. */
const CHUNK = 500

export type BulkItemInput = Omit<CreateListItemInput, 'orderIndex'>

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

/**
 * Adds `inputs` to the list, in order, as `createListItem` would one by one.
 * Returns the new rows in the order given, with the positions they ended at;
 * `undefined` when the list is not the user's or not there.
 *
 * Not atomic (the desktop driver has no reliable transaction, DECISIONS 10.16),
 * so a failure part-way cleans up after itself: the rows and groups this call
 * made are removed and the error goes on. Rows already in the list may be left
 * with gaps in their order numbers, which nothing depends on being contiguous.
 */
export async function createListItems(
  db: PortableDatabase,
  userId: string,
  listId: string,
  inputs: readonly BulkItemInput[],
): Promise<ListItem[] | undefined> {
  if (!(await findList(db, userId, listId))) return undefined
  if (inputs.length === 0) return []

  const existing = await db
    .select({ orderIndex: listItems.orderIndex, group: listItems.group })
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .all()
  const groups = await groupsOf(db, listId)

  // Group names by their trimmed, lower-cased spelling: the first the list has wins, as `ensureListGroup` finds it.
  const byKey = new Map<string, string>()
  for (const group of groups) {
    const key = group.name.trim().toLowerCase()
    if (!byKey.has(key)) byKey.set(key, group.name)
  }
  let nextGroupOrder = groups.reduce((top, group) => Math.max(top, group.orderIndex), -1) + 1
  const madeGroups: { name: string; orderIndex: number }[] = []

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
        madeGroups.push({ name: label, orderIndex: nextGroupOrder++ })
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

  const insertedGroupIds: string[] = []
  const insertedItemIds: string[] = []

  try {
    for (const batch of chunksOf(madeGroups)) {
      const rows = await db
        .insert(listGroups)
        .values(batch.map((group) => ({ listId, name: group.name, orderIndex: group.orderIndex })))
        .returning({ id: listGroups.id })
        .all()
      insertedGroupIds.push(...rows.map((row) => row.id))
    }

    for (const run of runs.reverse()) {
      await db
        .update(listItems)
        .set({ orderIndex: sql`${listItems.orderIndex} + ${run.by}` })
        .where(and(eq(listItems.listId, listId), between(listItems.orderIndex, run.from, run.to)))
        .run()
    }

    const created = new Map<string, ListItem>()
    const ids = placed.map(() => crypto.randomUUID())

    for (const batch of chunksOf(placed.map((entry, index) => ({ entry, id: ids[index]! })))) {
      insertedItemIds.push(...batch.map(({ id }) => id))

      const rows = await db
        .insert(listItems)
        .values(
          batch.map(({ entry: { input, group, slot }, id }) => ({
            id,
            listId,
            title: input.title,
            orderIndex: orders[slot]!,
            timeToConsumeMinutes: input.timeToConsumeMinutes,
            timeToConsumeIsEstimated: input.timeToConsumeIsEstimated ?? true,
            externalRef: input.externalRef ?? null,
            source: input.source ?? 'import',
            year: input.year ?? null,
            group,
            tags: normalizeItemTags(input.tags),
            notes: input.notes ?? null,
            isNew: input.isNew ?? false,
          })),
        )
        .returning()
        .all()
      for (const row of rows) created.set(row.id, row)
    }

    return ids.map((id) => created.get(id)!)
  } catch (error) {
    // Best effort, and never in place of the error that got us here.
    try {
      for (const batch of chunksOf(insertedItemIds)) await db.delete(listItems).where(inArray(listItems.id, batch)).run()
      for (const batch of chunksOf(insertedGroupIds)) await db.delete(listGroups).where(inArray(listGroups.id, batch)).run()
    } catch {
      // The original failure is the one to report.
    }

    throw error
  }
}

/**
 * Removes a list the caller has just made and could not fill, with everything
 * under it, so a failed import leaves nothing behind. Best effort: it never
 * throws, since it runs while another error is on its way to the user.
 */
export async function discardList(db: PortableDatabase, userId: string, listId: string): Promise<void> {
  try {
    await db.delete(lists).where(and(eq(lists.id, listId), eq(lists.userId, userId))).run()
  } catch {
    // Nothing more can be done from here.
  }
}
