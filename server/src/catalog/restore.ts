import { and, eq, gte, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import {
  dismissedItems,
  listGroups,
  listItems,
  listSnapshots,
  lists,
  type List,
  type ListGroup,
  type ListItem,
} from '../db/schema.js'
import { ensureListGroup, GroupNameError } from './groups.js'
import { findList } from './repository.js'
import {
  toDismissalPayload,
  toGroupPayload,
  toItemPayload,
  type DismissalPayload,
  type GroupRestore,
  type ItemPayload,
  type ItemRestore,
  type ItemSetRestore,
  type ListRestore,
  type OrderRestore,
} from './restorePayloads.js'

export type {
  GroupRestore,
  ItemRestore,
  ItemSetRestore,
  ListRestore,
  OrderRestore,
} from './restorePayloads.js'
import { setGroupPositions, setItemPositions } from './orderIndex.js'

/**
 * The other half of Undo (D2, task 10.19a): put back what a destructive call
 * returned, with the original ids, `order_index` and `consumed_at`.
 *
 * The user always comes from the caller — a payload never says whose it is.
 * Each restore is idempotent where it can be (an item or group whose id is
 * already there is left alone), so a double click on Undo does no harm.
 */

/** A list with this id already exists: restoring would overwrite someone's data. */
export class ListExistsError extends Error {}

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 500

async function insertInBatches<T>(rows: T[], insert: (batch: T[]) => Promise<void>): Promise<void> {
  for (let start = 0; start < rows.length; start += BATCH) {
    await insert(rows.slice(start, start + BATCH))
  }
}

const itemRow = (listId: string, item: ItemPayload) => ({
  id: item.id,
  listId,
  title: item.title,
  orderIndex: item.orderIndex,
  timeToConsumeMinutes: item.timeToConsumeMinutes,
  timeToConsumeIsEstimated: item.timeToConsumeIsEstimated,
  externalRef: item.externalRef,
  source: item.source,
  year: item.year,
  group: item.group,
  tags: item.tags,
  consumedAt: item.consumedAt ? new Date(item.consumedAt) : null,
  notes: item.notes,
  isNew: item.isNew ?? false,
  createdAt: new Date(item.createdAt),
  updatedAt: new Date(item.updatedAt),
})

const dismissalRow = (listId: string, row: DismissalPayload) => ({
  id: row.id,
  listId,
  externalRef: row.externalRef,
  titleKey: row.titleKey,
  createdAt: new Date(row.createdAt),
})

/** A group for every label the items carry, in the order the labels first appear. */
async function ensureGroupsFor(
  db: PortableDatabase,
  listId: string,
  items: readonly ItemPayload[],
): Promise<void> {
  const seen = new Set<string>()
  for (const item of [...items].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (item.group && !seen.has(item.group)) {
      seen.add(item.group)
      await ensureListGroup(db, listId, item.group)
    }
  }
}

export async function restoreListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { item, dismissalId }: ItemRestore,
): Promise<ListItem | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const existing = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.id, item.id), eq(listItems.listId, listId)))
    .get()
  if (existing) return existing

  // Its group may have been deleted while it was gone (an empty group can be).
  const group = item.group ? (await ensureListGroup(db, listId, item.group)).name : null

  const restored = await db
    .insert(listItems)
    .values({ ...itemRow(listId, item), group })
    .returning()
    .get()

  if (dismissalId) {
    await db
      .delete(dismissedItems)
      .where(and(eq(dismissedItems.id, dismissalId), eq(dismissedItems.listId, listId)))
      .run()
  }

  return restored
}

export async function restoreListGroup(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { group, items = [], dismissalIds = [] }: GroupRestore,
): Promise<ListGroup | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const restored = await restoreGroupRow(db, listId, group)

  // A group deleted with its items: they come back as they were (ids, positions, ticks).
  const present = new Set(
    (await db.select({ id: listItems.id }).from(listItems).where(eq(listItems.listId, listId)).all()).map((row) => row.id),
  )
  const missing = items.filter((item) => !present.has(item.id))
  await insertInBatches(missing, async (batch) => {
    await db.insert(listItems).values(batch.map((item) => itemRow(listId, item))).run()
  })
  for (const id of dismissalIds) {
    await db.delete(dismissedItems).where(and(eq(dismissedItems.id, id), eq(dismissedItems.listId, listId))).run()
  }

  return restored
}

async function restoreGroupRow(db: PortableDatabase, listId: string, group: GroupRestore['group']): Promise<ListGroup> {
  const groups = await db.select().from(listGroups).where(eq(listGroups.listId, listId)).all()
  const existing = groups.find((entry) => entry.id === group.id)
  if (existing) return existing
  if (groups.some((entry) => entry.name.trim().toLowerCase() === group.name.trim().toLowerCase())) {
    throw new GroupNameError('duplicate')
  }

  // Everything at or after its old position moves down one to make room.
  await db
    .update(listGroups)
    .set({ orderIndex: sql`${listGroups.orderIndex} + 1` })
    .where(and(eq(listGroups.listId, listId), gte(listGroups.orderIndex, group.orderIndex)))
    .run()

  return await db
    .insert(listGroups)
    .values({
      id: group.id,
      listId,
      name: group.name,
      orderIndex: group.orderIndex,
      createdAt: new Date(group.createdAt),
      updatedAt: new Date(group.updatedAt),
    })
    .returning()
    .get()
}

export async function restoreList(
  db: PortableDatabase,
  userId: string,
  payload: ListRestore,
): Promise<List> {
  const { list, items, groups, snapshot, dismissals } = payload

  const taken = await db.select({ id: lists.id }).from(lists).where(eq(lists.id, list.id)).get()
  if (taken) throw new ListExistsError('a list with this id already exists')

  const restored = await db
    .insert(lists)
    .values({
      ...list,
      userId,
      // Absent in a payload written before 12.1; null then, which is how a list with no known copy date reads.
      snapshotFetchedAt: list.snapshotFetchedAt ? new Date(list.snapshotFetchedAt) : null,
      createdAt: new Date(list.createdAt),
      updatedAt: new Date(list.updatedAt),
    })
    .returning()
    .get()

  await insertInBatches(items, async (batch) => {
    await db.insert(listItems).values(batch.map((item) => itemRow(list.id, item))).run()
  })
  await insertInBatches(groups, async (batch) => {
    await db
      .insert(listGroups)
      .values(
        batch.map((group) => ({
          id: group.id,
          listId: list.id,
          name: group.name,
          orderIndex: group.orderIndex,
          createdAt: new Date(group.createdAt),
          updatedAt: new Date(group.updatedAt),
        })),
      )
      .run()
  })
  await insertInBatches(snapshot, async (batch) => {
    await db
      .insert(listSnapshots)
      .values(batch.map((row) => ({ ...row, listId: list.id })))
      .run()
  })
  await insertInBatches(dismissals, async (batch) => {
    await db
      .insert(dismissedItems)
      .values(batch.map((row) => dismissalRow(list.id, row)))
      .run()
  })

  return restored
}

/** A list's items and dismissals exactly as they stand — taken before something replaces them. */
export async function captureItemSet(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ItemSetRestore | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const items = await db.select().from(listItems).where(eq(listItems.listId, listId)).all()
  const dismissals = await db
    .select()
    .from(dismissedItems)
    .where(eq(dismissedItems.listId, listId))
    .all()

  const groups = await db.select().from(listGroups).where(eq(listGroups.listId, listId)).all()
  const list = (await findList(db, userId, listId))!

  return {
    items: items.map(toItemPayload).sort((a, b) => a.orderIndex - b.orderIndex),
    dismissals: dismissals.map(toDismissalPayload),
    groups: groups.map(toGroupPayload).sort((a, b) => a.orderIndex - b.orderIndex),
    list: { title: list.title, description: list.description, status: list.status },
  }
}

/** Replaces the list's items and dismissals with the captured set — undoing a Reset. */
export async function restoreItemSet(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { items, dismissals, groups, list }: ItemSetRestore,
): Promise<ListItem[] | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  await db.delete(listItems).where(eq(listItems.listId, listId)).run()
  await db.delete(dismissedItems).where(eq(dismissedItems.listId, listId)).run()

  await insertInBatches(items, async (batch) => {
    await db.insert(listItems).values(batch.map((item) => itemRow(listId, item))).run()
  })
  await insertInBatches(dismissals, async (batch) => {
    await db
      .insert(dismissedItems)
      .values(batch.map((row) => dismissalRow(listId, row)))
      .run()
  })
  if (groups) {
    // The group rows exactly as they were: ids, order and any empty ones.
    await db.delete(listGroups).where(eq(listGroups.listId, listId)).run()
    await insertInBatches(groups, async (batch) => {
      await db
        .insert(listGroups)
        .values(
          batch.map((group) => ({
            id: group.id,
            listId,
            name: group.name,
            orderIndex: group.orderIndex,
            createdAt: new Date(group.createdAt),
            updatedAt: new Date(group.updatedAt),
          })),
        )
        .run()
    })
  } else {
    await ensureGroupsFor(db, listId, items)
  }

  if (list) {
    await db
      .update(lists)
      .set({ title: list.title, description: list.description, status: list.status })
      .where(eq(lists.id, listId))
      .run()
  }

  return await db.select().from(listItems).where(eq(listItems.listId, listId)).all()
}

/** Puts every item and group back at the position it held before a sort (Sort chronologically's Undo). */
export async function restoreOrder(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { items, groups }: OrderRestore,
): Promise<boolean> {
  if (!(await findList(db, userId, listId))) return false

  await setItemPositions(db, listId, items)
  await setGroupPositions(db, listId, groups)

  return true
}
