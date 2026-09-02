import { and, asc, eq, max } from 'drizzle-orm'
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

export function findLists(db: AppDatabase, userId: string): List[] {
  return db
    .select()
    .from(lists)
    .where(eq(lists.userId, userId))
    .orderBy(asc(lists.createdAt))
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
    .orderBy(asc(listItems.orderIndex))
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
