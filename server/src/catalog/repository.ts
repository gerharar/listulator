import { and, asc, count, eq, getTableColumns, max, sql } from 'drizzle-orm'
import type { AppDatabase } from '../db/client.js'
import { listItems, lists, type List, type ListItem, type ListSource } from '../db/schema.js'

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
}

export interface UpdateListItemInput {
  title?: string
  orderIndex?: number
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
}

export function createList(db: AppDatabase, userId: string, input: CreateListInput): List {
  return db
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

export function findListsWithStats(db: AppDatabase, userId: string): ListWithStats[] {
  const rows = db
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

export function findListWithStats(
  db: AppDatabase,
  userId: string,
  listId: string,
): ListWithStats | undefined {
  const row = db
    .select(statsSelection())
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .groupBy(lists.id)
    .get()

  return row ? toListWithStats(row as StatsRow) : undefined
}

export function findLists(db: AppDatabase, userId: string): List[] {
  return db
    .select()
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(asc(lists.createdAt), asc(lists.id))
    .all()
}

export function findList(db: AppDatabase, userId: string, listId: string): List | undefined {
  return db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .get()
}

export function updateList(
  db: AppDatabase,
  userId: string,
  listId: string,
  patch: UpdateListInput,
): List | undefined {
  if (!findList(db, userId, listId)) return undefined

  return db
    .update(lists)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .returning()
    .get()
}

/** Items go with it — the foreign key cascades (client.ts enables them). */
export function deleteList(db: AppDatabase, userId: string, listId: string): boolean {
  const deleted = db
    .delete(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .returning()
    .all()

  return deleted.length > 0
}

export function findListItems(
  db: AppDatabase,
  userId: string,
  listId: string,
): ListItem[] | undefined {
  if (!findList(db, userId, listId)) return undefined

  return db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.orderIndex), asc(listItems.id))
    .all()
}

function nextOrderIndex(db: AppDatabase, listId: string): number {
  const result = db
    .select({ highest: max(listItems.orderIndex) })
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .get()

  return (result?.highest ?? -1) + 1
}

export function createListItem(
  db: AppDatabase,
  userId: string,
  listId: string,
  input: CreateListItemInput,
): ListItem | undefined {
  if (!findList(db, userId, listId)) return undefined

  return db
    .insert(listItems)
    .values({
      listId,
      title: input.title,
      orderIndex: input.orderIndex ?? nextOrderIndex(db, listId),
      timeToConsumeMinutes: input.timeToConsumeMinutes,
      timeToConsumeIsEstimated: input.timeToConsumeIsEstimated ?? true,
      externalRef: input.externalRef ?? null,
    })
    .returning()
    .get()
}

export function findListItem(
  db: AppDatabase,
  userId: string,
  listId: string,
  itemId: string,
): ListItem | undefined {
  if (!findList(db, userId, listId)) return undefined

  return db
    .select()
    .from(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .get()
}

export function updateListItem(
  db: AppDatabase,
  userId: string,
  listId: string,
  itemId: string,
  patch: UpdateListItemInput,
): ListItem | undefined {
  if (!findListItem(db, userId, listId, itemId)) return undefined

  return db
    .update(listItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .get()
}

export function deleteListItem(
  db: AppDatabase,
  userId: string,
  listId: string,
  itemId: string,
): boolean {
  if (!findList(db, userId, listId)) return false

  const deleted = db
    .delete(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .all()

  return deleted.length > 0
}

/**
 * Sets consumed state explicitly rather than flipping it: a checkbox knows the
 * state it wants, and an explicit set stays correct if the same request is
 * retried or two tabs are open.
 */
export function setListItemConsumed(
  db: AppDatabase,
  userId: string,
  listId: string,
  itemId: string,
  consumed: boolean,
  now: Date = new Date(),
): ListItem | undefined {
  if (!findListItem(db, userId, listId, itemId)) return undefined

  return db
    .update(listItems)
    .set({ consumedAt: consumed ? now : null, updatedAt: now })
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .get()
}
