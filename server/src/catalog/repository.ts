import { and, asc, count, eq, getTableColumns, inArray, max, or, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import {
  dismissalTitleKey,
  dismissedItems,
  listItems,
  lists,
  type DismissedItem,
  type ItemSource,
  type List,
  type ListItem,
  type ListSource,
} from '../db/schema.js'

/**
 * Data access for lists and their items.
 *
 * Every function takes the owning `userId` and filters on it, so scoping is
 * structural rather than something each handler has to remember (SPEC.md §11).
 * Items are reached only through their list, which is where ownership lives.
 *
 * Functions return `undefined` when the target does not exist *or* belongs to
 * someone else — callers cannot distinguish the two, which is what stops the
 * API confirming the existence of other people's lists.
 *
 * Every function is `async`, even though the server's own driver
 * (`better-sqlite3`) is synchronous. The standalone app (`docs/DECISIONS.md`,
 * "Standalone-app distribution") reaches SQLite through Drizzle's
 * `sqlite-proxy` driver, which genuinely returns promises — this file stays
 * the single implementation shared by both by awaiting every call.
 */

export interface CreateListInput {
  title: string
  mediaType: string
  source?: ListSource
  externalRef?: string | null
}

export interface UpdateListInput {
  title?: string
  mediaType?: string
  source?: ListSource
  externalRef?: string | null
}

export interface CreateListItemInput {
  title: string
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated?: boolean
  /** Defaults to the end of the list. */
  orderIndex?: number
  /** Upstream id, when the source has one. */
  externalRef?: string | null
  /** Defaults to `'import'` — every real caller should pass this explicitly. */
  source?: ItemSource
}

export interface UpdateListItemInput {
  title?: string
  orderIndex?: number
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
}

export async function createList(db: PortableDatabase, userId: string, input: CreateListInput): Promise<List> {
  return await db
    .insert(lists)
    .values({
      userId,
      title: input.title,
      mediaType: input.mediaType,
      source: input.source ?? 'manual',
      externalRef: input.externalRef ?? null,
    })
    .returning()
    .get()
}

/**
 * Progress toward finishing a list — the unit this whole app is about
 * (SPEC.md §1). Derived on read, never stored, so it cannot drift from the
 * items it summarises.
 */
export interface ListStats {
  totalItems: number
  consumedItems: number
  /** 0–100, one decimal place. An empty list is 0% — see note below. */
  completionPercent: number
  /** Sum over unconsumed items; durations are never null (SPEC.md §4). */
  timeRemainingMinutes: number
  /** Null when nothing has been consumed yet — "maximally neglected" for ranking. */
  lastConsumedAt: Date | null
}

export type ListWithStats = List & { stats: ListStats }

/**
 * One grouped query for any number of lists, rather than loading every item to
 * count them — the lists overview shows a completion badge per list, and this
 * keeps that a single round trip regardless of library size.
 */
function statsSelection() {
  return {
    ...getTableColumns(lists),
    totalItems: count(listItems.id),
    // count() over a nullable column counts only non-null values.
    consumedItems: count(listItems.consumedAt),
    timeRemainingMinutes: sql<number>`coalesce(sum(case when ${listItems.consumedAt} is null then ${listItems.timeToConsumeMinutes} else 0 end), 0)`,
    // Drizzle applies the column's timestamp mapping here, so this is already
    // a Date — do not convert it again.
    lastConsumedAt: max(listItems.consumedAt),
  }
}

type StatsRow = List & {
  totalItems: number
  consumedItems: number
  timeRemainingMinutes: number
  lastConsumedAt: Date | null
}

function toListWithStats(row: StatsRow): ListWithStats {
  const { totalItems, consumedItems, timeRemainingMinutes, lastConsumedAt, ...list } = row

  return {
    ...list,
    stats: {
      totalItems,
      consumedItems,
      // An empty list is 0% complete, not 100%. Nothing has been finished, and
      // calling it complete would let empty lists win "I'm tired, boss", which
      // ranks on being nearly done.
      completionPercent:
        totalItems === 0 ? 0 : Math.round((consumedItems / totalItems) * 1000) / 10,
      timeRemainingMinutes: Number(timeRemainingMinutes),
      lastConsumedAt: lastConsumedAt ?? null,
    },
  }
}

export async function findListsWithStats(db: PortableDatabase, userId: string): Promise<ListWithStats[]> {
  const rows = await db
    .select(statsSelection())
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(eq(lists.userId, userId))
    .groupBy(lists.id)
    // id breaks ties so ordering is total and stable, not just "usually right".
    .orderBy(asc(lists.createdAt), asc(lists.id))
    .all()

  return rows.map((row) => toListWithStats(row as StatsRow))
}

export async function findListWithStats(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ListWithStats | undefined> {
  const row = await db
    .select(statsSelection())
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .groupBy(lists.id)
    .get()

  return row ? toListWithStats(row as StatsRow) : undefined
}

export async function findLists(db: PortableDatabase, userId: string): Promise<List[]> {
  return await db
    .select()
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(asc(lists.createdAt), asc(lists.id))
    .all()
}

export async function findList(db: PortableDatabase, userId: string, listId: string): Promise<List | undefined> {
  return await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .get()
}

export async function updateList(
  db: PortableDatabase,
  userId: string,
  listId: string,
  patch: UpdateListInput,
): Promise<List | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  return await db
    .update(lists)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .returning()
    .get()
}

/** Items go with it — the foreign key cascades (client.ts enables them). */
export async function deleteList(db: PortableDatabase, userId: string, listId: string): Promise<boolean> {
  const deleted = await db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .returning()
    .all()

  return deleted.length > 0
}

export async function findListItems(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ListItem[] | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  return await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.orderIndex), asc(listItems.id))
    .all()
}

async function nextOrderIndex(db: PortableDatabase, listId: string): Promise<number> {
  const result = await db
    .select({ highest: max(listItems.orderIndex) })
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .get()

  return (result?.highest ?? -1) + 1
}

export async function createListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  input: CreateListItemInput,
): Promise<ListItem | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  return await db
    .insert(listItems)
    .values({
      listId,
      title: input.title,
      orderIndex: input.orderIndex ?? (await nextOrderIndex(db, listId)),
      timeToConsumeMinutes: input.timeToConsumeMinutes,
      timeToConsumeIsEstimated: input.timeToConsumeIsEstimated ?? true,
      externalRef: input.externalRef ?? null,
      source: input.source ?? 'import',
    })
    .returning()
    .get()
}

export async function findListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemId: string,
): Promise<ListItem | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  return await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .get()
}

export async function updateListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemId: string,
  patch: UpdateListItemInput,
): Promise<ListItem | undefined> {
  if (!(await findListItem(db, userId, listId, itemId))) return undefined

  return await db
    .update(listItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .get()
}

/**
 * Deleting an item also records that you did not want it, so a refresh stops
 * offering it back. Undone by importing it again — see `clearDismissals`.
 */
export async function deleteListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemId: string,
): Promise<boolean> {
  if (!(await findList(db, userId, listId))) return false

  const deleted = await db
    .delete(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .all()

  for (const item of deleted) {
    await db
      .insert(dismissedItems)
      .values({
        listId,
        titleKey: dismissalTitleKey(item.title),
        ...(item.externalRef ? { externalRef: item.externalRef } : {}),
      })
      .run()
  }

  return deleted.length > 0
}

export async function findDismissals(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<DismissedItem[]> {
  if (!(await findList(db, userId, listId))) return []

  return await db.select().from(dismissedItems).where(eq(dismissedItems.listId, listId)).all()
}

/**
 * Forgets dismissals for things being added back, so an item restored by a
 * rescan is not silently hidden by the next one.
 */
export async function clearDismissals(
  db: PortableDatabase,
  listId: string,
  items: { title: string; externalRef?: string | undefined }[],
): Promise<void> {
  if (items.length === 0) return

  const titleKeys = items.map((item) => dismissalTitleKey(item.title))
  const refs = items
    .map((item) => item.externalRef)
    .filter((ref): ref is string => Boolean(ref))

  await db
    .delete(dismissedItems)
    .where(
      and(
        eq(dismissedItems.listId, listId),
        or(
          inArray(dismissedItems.titleKey, titleKeys),
          ...(refs.length > 0 ? [inArray(dismissedItems.externalRef, refs)] : []),
        ),
      ),
    )
    .run()
}

/**
 * Sets consumed state explicitly rather than flipping it: a checkbox knows the
 * state it wants, and an explicit set stays correct if the same request is
 * retried or two tabs are open.
 */
export async function setListItemConsumed(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemId: string,
  consumed: boolean,
  now: Date = new Date(),
): Promise<ListItem | undefined> {
  if (!(await findListItem(db, userId, listId, itemId))) return undefined

  return await db
    .update(listItems)
    .set({ consumedAt: consumed ? now : null, updatedAt: now })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .get()
}
