import { and, asc, count, eq, getTableColumns, inArray, max, or, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { ensureListGroup, placeNewItem } from './groups.js'
import {
  dismissalTitleKey,
  dismissedItems,
  listItems,
  listSnapshots,
  lists,
  type DismissedItem,
  type ItemSource,
  type List,
  type ListItem,
  type ListSnapshotItem,
  type ListSource,
  type ListStatus,
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
  /** A longer free-text blurb alongside `title`. Null/omitted if not set. */
  description?: string | null
  mediaType: string
  source?: ListSource
  externalRef?: string | null
  /** Production status of the thing the list is about. Null/omitted means unknown. */
  status?: ListStatus | null
  /** The original raw uploaded/pasted YAML text — `source: 'file'` lists only (D4). */
  sourceYaml?: string | null
  /** `title` as it stood at import time — `source: 'api' | 'llm'` lists only (D4). */
  arrivedTitle?: string | null
  /** `description` as it stood at import time — `source: 'api' | 'llm'` lists only (D4). */
  arrivedDescription?: string | null
  /** `status` as it stood at import time — `source: 'api' | 'llm'` lists only (D4). */
  arrivedStatus?: ListStatus | null
}

export interface UpdateListInput {
  title?: string
  description?: string | null
  mediaType?: string
  source?: ListSource
  externalRef?: string | null
  status?: ListStatus | null
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
  /** Release/publish year, when the source knows one. Null if not. */
  year?: number | null
  /** Optional grouping label, e.g. "Season 1". Null if not grouped. */
  group?: string | null
  /** Generic per-item display tags (SPEC.md §4), e.g. ["Album", "Live"]. Null if none. */
  tags?: string[] | null
  /** Curator-authored disambiguation prose, capped at 2048 chars. Null if none. Never adapter-set. */
  notes?: string | null
}

export interface UpdateListItemInput {
  title?: string
  orderIndex?: number
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
  /** Join (a string) or leave (null) a group — omit to leave unchanged. */
  group?: string | null
}

export async function createList(
  db: PortableDatabase,
  userId: string,
  input: CreateListInput,
): Promise<List> {
  return await db
    .insert(lists)
    .values({
      userId,
      title: input.title,
      description: input.description ?? null,
      mediaType: input.mediaType,
      source: input.source ?? 'manual',
      externalRef: input.externalRef ?? null,
      status: input.status ?? null,
      sourceYaml: input.sourceYaml ?? null,
      arrivedTitle: input.arrivedTitle ?? null,
      arrivedDescription: input.arrivedDescription ?? null,
      arrivedStatus: input.arrivedStatus ?? null,
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

export async function findListsWithStats(
  db: PortableDatabase,
  userId: string,
): Promise<ListWithStats[]> {
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

export async function findList(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<List | undefined> {
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
export async function deleteList(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<boolean> {
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

/**
 * `itemIds` names a mismatched set — missing an item, naming one twice, or
 * naming one from a different list. Distinct from "not found" (the list
 * itself is missing/not yours): this can only happen if a caller's own
 * bookkeeping is wrong, since both UIs always start from this list's own
 * current items.
 */
export class ReorderMismatchError extends Error {}

/**
 * Renumbers a list's items to exactly the order given (task 6.7) — a bulk
 * "set the whole order" rather than a single move-to-position, since at this
 * app's bounded list sizes renumbering everything on every reorder is cheap
 * and avoids fractional/gap-based indexing this scale doesn't justify.
 *
 * Which pairs of items a caller may legally swap (never crossing a season
 * boundary, task 6.6) is a UI-level rule enforced by `ListDetail.tsx`, not
 * re-validated here — this just applies whatever full order it's given, the
 * same trust boundary every other write in this file already has for a
 * single-user app.
 */
export async function reorderListItems(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemIds: string[],
): Promise<ListItem[] | undefined> {
  const existing = await findListItems(db, userId, listId)
  if (!existing) return undefined

  const existingIds = new Set(existing.map((item) => item.id))
  const isExactSet =
    itemIds.length === existing.length &&
    new Set(itemIds).size === itemIds.length &&
    itemIds.every((id) => existingIds.has(id))

  if (!isExactSet) {
    throw new ReorderMismatchError("itemIds must be exactly this list's current items, each once")
  }

  // Sequential, not Promise.all — see the from-source route for why.
  for (const [index, id] of itemIds.entries()) {
    await db
      .update(listItems)
      .set({ orderIndex: index, updatedAt: new Date() })
      .where(and(eq(listItems.id, id), eq(listItems.listId, listId)))
      .run()
  }

  return findListItems(db, userId, listId)
}

export async function createListItem(
  db: PortableDatabase,
  userId: string,
  listId: string,
  input: CreateListItemInput,
): Promise<ListItem | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  // A label gets a group of its own the first time it is used (D3), spelled
  // the way the list already spells it.
  const label = input.group?.trim()
  const group = label ? (await ensureListGroup(db, listId, label)).name : null

  return await db
    .insert(listItems)
    .values({
      listId,
      title: input.title,
      // At the end of its own group (BL-003), not `max + 1` of the whole list.
      orderIndex: input.orderIndex ?? (await placeNewItem(db, listId, group)),
      timeToConsumeMinutes: input.timeToConsumeMinutes,
      timeToConsumeIsEstimated: input.timeToConsumeIsEstimated ?? true,
      externalRef: input.externalRef ?? null,
      source: input.source ?? 'import',
      year: input.year ?? null,
      group,
      tags: input.tags ?? null,
      notes: input.notes ?? null,
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

  // Joining a label the list has no group for yet makes one (D3), spelled the
  // way the list already spells it.
  const label = typeof patch.group === 'string' ? patch.group.trim() : undefined
  const group = label ? { group: (await ensureListGroup(db, listId, label)).name } : {}

  return await db
    .update(listItems)
    .set({ ...patch, ...group, updatedAt: new Date() })
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
  const refs = items.map((item) => item.externalRef).filter((ref): ref is string => Boolean(ref))

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

export interface CreateListSnapshotItemInput {
  title: string
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated: boolean
  orderIndex: number
  externalRef?: string | null
  year?: number | null
  group?: string | null
  tags?: string[] | null
  notes?: string | null
}

/**
 * Writes a list's arrived-state snapshot (D4) — `source: 'api' | 'llm'`
 * lists only, once, in the same import that creates the list's real
 * items. Never called again for that list: refresh and sync leave the
 * snapshot untouched, by design, so it stays "what arrived," not "what's
 * here now."
 */
export async function createListSnapshot(
  db: PortableDatabase,
  listId: string,
  items: CreateListSnapshotItemInput[],
): Promise<void> {
  if (items.length === 0) return

  await db
    .insert(listSnapshots)
    .values(
      items.map((item) => ({
        listId,
        title: item.title,
        orderIndex: item.orderIndex,
        timeToConsumeMinutes: item.timeToConsumeMinutes,
        timeToConsumeIsEstimated: item.timeToConsumeIsEstimated,
        externalRef: item.externalRef ?? null,
        year: item.year ?? null,
        group: item.group ?? null,
        tags: item.tags ?? null,
        notes: item.notes ?? null,
      })),
    )
    .run()
}

/** The arrived-state snapshot for one list, in its original order. Empty for any list without one. */
export async function findListSnapshot(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ListSnapshotItem[]> {
  if (!(await findList(db, userId, listId))) return []

  return await db
    .select()
    .from(listSnapshots)
    .where(eq(listSnapshots.listId, listId))
    .orderBy(asc(listSnapshots.orderIndex), asc(listSnapshots.id))
    .all()
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
