import { withListLock } from './listLock.js'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
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
import { ensureListGroup, GroupNameError, groupsOf, missingGroups } from './groups.js'
import { findList } from './repository.js'
import { validYearPair } from './years.js'
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
import { batches, groupPositionStatements, itemPositionStatements } from './orderIndex.js'
import { runAtomically } from '../db/atomic.js'

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
  yearUnk: validYearPair(item.year, item.yearUnk)?.yearUnk ?? 0,
  group: item.group,
  tags: item.tags,
  consumedAt: item.consumedAt ? new Date(item.consumedAt) : null,
  notes: item.notes,
  userNote: item.userNote ?? null,
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

  // Everything is read before the first write (53.5d): the groups that stand, and the items already there (a group deleted with its items:
  // they come back as they were, ids, positions and ticks; `list_items` is not touched by the group row's own statements).
  const groups = await db.select().from(listGroups).where(eq(listGroups.listId, listId)).all()
  const existing = groups.find((entry) => entry.id === group.id)
  if (!existing && groups.some((entry) => entry.name.trim().toLowerCase() === group.name.trim().toLowerCase())) {
    throw new GroupNameError('duplicate')
  }
  const present = new Set(
    (await db.select({ id: listItems.id }).from(listItems).where(eq(listItems.listId, listId)).all()).map((row) => row.id),
  )
  const missing = items.filter((item) => !present.has(item.id))

  // ONE transaction: the group row (everything at or after its old position moves down one to make room), its items, and the forgetting of
  // the dismissals that deleting them made (in batches of 500 ids: one statement each would pass the desktop's cap of 2,000 per call).
  const results = await runAtomically(db, [
    ...(existing
      ? []
      : [
          db
            .update(listGroups)
            .set({ orderIndex: sql`${listGroups.orderIndex} + 1` })
            .where(and(eq(listGroups.listId, listId), gte(listGroups.orderIndex, group.orderIndex))),
          db
            .insert(listGroups)
            .values({
              id: group.id,
              listId,
              name: group.name,
              orderIndex: group.orderIndex,
              createdAt: new Date(group.createdAt),
              updatedAt: new Date(group.updatedAt),
            })
            .returning(),
        ]),
    ...batches(missing).map((batch) => db.insert(listItems).values(batch.map((item) => itemRow(listId, item)))),
    ...batches(dismissalIds).map((batch) => db.delete(dismissedItems).where(and(inArray(dismissedItems.id, batch), eq(dismissedItems.listId, listId)))),
  ])

  // Without an existing row the list's first two statements are the shift and the insert, whose row is the answer.
  return existing ?? (results as unknown as ListGroup[][])[1]![0]!
}

export async function restoreList(
  db: PortableDatabase,
  userId: string,
  payload: ListRestore,
): Promise<List> {
  const { list, items, groups, snapshot, dismissals } = payload

  const taken = await db.select({ id: lists.id }).from(lists).where(eq(lists.id, list.id)).get()
  if (taken) throw new ListExistsError('a list with this id already exists')

  // The list and everything that was in it come back in ONE transaction (53.5d): a list that is restored is whole, and one whose restore
  // fails or is cut short is not there at all, so there is no half-restored list to find. The list's own row is the answer.
  const results = await runAtomically(db, [
    db
      .insert(lists)
      .values({
        ...list,
        userId,
        // Absent in a payload written before 12.1; null then, which is how a list with no known copy date reads.
        snapshotFetchedAt: list.snapshotFetchedAt ? new Date(list.snapshotFetchedAt) : null,
        isSample: list.isSample ?? false,
        createdAt: new Date(list.createdAt),
        updatedAt: new Date(list.updatedAt),
      })
      .returning(),
    ...batches(items).map((batch) => db.insert(listItems).values(batch.map((item) => itemRow(list.id, item)))),
    ...batches(groups).map((batch) =>
      db.insert(listGroups).values(
        batch.map((group) => ({
          id: group.id,
          listId: list.id,
          name: group.name,
          orderIndex: group.orderIndex,
          createdAt: new Date(group.createdAt),
          updatedAt: new Date(group.updatedAt),
        })),
      ),
    ),
    ...batches(snapshot).map((batch) => db.insert(listSnapshots).values(batch.map((row) => ({ ...row, listId: list.id })))),
    ...batches(dismissals).map((batch) => db.insert(dismissedItems).values(batch.map((row) => dismissalRow(list.id, row)))),
  ])

  return (results[0] as List[])[0]!
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

/** Replaces the list's items and dismissals with the captured set — undoing a Reset. Takes its turn behind a Reset on the list (BL-103). */
export function restoreItemSet(
  db: PortableDatabase,
  userId: string,
  listId: string,
  set: ItemSetRestore,
): Promise<ListItem[] | undefined> {
  return withListLock(listId, () => restoreItemSetNow(db, userId, listId, set))
}

/**
 * `restoreItemSet` without waiting its turn. All or nothing (Phase 53, 53.5a): the list's items and dismissals (and its groups, when the
 * payload has them) are replaced in ONE transaction, so a restore that fails or is cut short leaves the list exactly as it was and there is
 * nothing to retry (it used to be tried a second time, because the desktop could leave it half done).
 */
export async function restoreItemSetNow(
  db: PortableDatabase,
  userId: string,
  listId: string,
  set: ItemSetRestore,
): Promise<ListItem[] | undefined> {
  return await restoreItemSetOnce(db, userId, listId, set)
}

async function restoreItemSetOnce(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { items, dismissals, groups, list }: ItemSetRestore,
): Promise<ListItem[] | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  // Read before anything is written: the groups that stand now, for a payload that carries none of its own (an older Undo).
  const standing = groups ? [] : await groupsOf(db, listId)

  await runAtomically(db, [
    db.delete(listItems).where(eq(listItems.listId, listId)),
    db.delete(dismissedItems).where(eq(dismissedItems.listId, listId)),
    ...batches(items).map((batch) => db.insert(listItems).values(batch.map((item) => itemRow(listId, item)))),
    ...batches(dismissals).map((batch) => db.insert(dismissedItems).values(batch.map((row) => dismissalRow(listId, row)))),
    ...(groups
      ? [
          // The group rows exactly as they were: ids, order and any empty ones.
          db.delete(listGroups).where(eq(listGroups.listId, listId)),
          ...batches(groups).map((batch) =>
            db.insert(listGroups).values(
              batch.map((group) => ({
                id: group.id,
                listId,
                name: group.name,
                orderIndex: group.orderIndex,
                createdAt: new Date(group.createdAt),
                updatedAt: new Date(group.updatedAt),
              })),
            ),
          ),
        ]
      : missingGroups(standing, items).map((group) => db.insert(listGroups).values({ listId, name: group.name, orderIndex: group.orderIndex }))),
    ...(list ? [db.update(lists).set({ title: list.title, description: list.description, status: list.status }).where(eq(lists.id, listId))] : []),
  ])

  // After the commit: what the list holds now is the answer.
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

  // The items' and the groups' positions in ONE transaction (53.5c): the order is the one it was or the one it is.
  await runAtomically(db, [...itemPositionStatements(db, listId, items), ...groupPositionStatements(db, listId, groups)])

  return true
}
