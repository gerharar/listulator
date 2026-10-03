import { and, asc, count, eq, getTableColumns, inArray, max, or, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { normalizeItemTags } from './facets.js'
import { pendingCounts } from './runtimes.js'
import { ensureListGroup, findListGroups, placeNewItem } from './groups.js'
import {
  toDismissalPayload,
  toGroupPayload,
  toItemPayload,
  toListPayload,
  toSnapshotPayload,
  type ItemRestore,
  type ListRestore,
} from './restorePayloads.js'
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
  /** When the arrived copy was fetched from its source; set wherever `arrived*` is (task 12.1). */
  snapshotFetchedAt?: Date | null
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
  /** Arrived with a refresh and not yet seen (10.17). Defaults to false. */
  isNew?: boolean
}

export interface UpdateListItemInput {
  title?: string
  orderIndex?: number
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
  /** Join (a string) or leave (null) a group — omit to leave unchanged. */
  group?: string | null
  /** Replace the item's tags (null clears) — omit to leave unchanged (U5). */
  tags?: string[] | null
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
      snapshotFetchedAt: input.snapshotFetchedAt ?? null,
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
  /** Items that arrived with the last refresh and have not been marked seen (10.17). */
  newItems: number
  consumedItems: number
  /** 0–100, one decimal place. An empty list is 0% — see note below. */
  completionPercent: number
  /** Sum over unconsumed items; durations are never null (SPEC.md §4). */
  timeRemainingMinutes: number
  /** Null when nothing has been consumed yet — "maximally neglected" for ranking. */
  lastConsumedAt: Date | null
  /**
   * Items still waiting for their length to be looked up (task 15.5): the list was built from a listing
   * and the lengths fill in afterwards. Derived, never stored; 0 for a list with nothing to look up.
   * Always set by the repository; optional in the type so a hand-built stats object (a ranking test)
   * need not carry it, and absent means 0.
   */
  runtimesPending?: number
}

/**
 * What the stats need to count `runtimesPending`: which categories can have lengths looked up, and which
 * kinds of item ref (`enrichPrefixesByMediaType`). Absent, the count is 0, so a caller that does not
 * show progress pays nothing.
 */
export interface RuntimeStatsOptions {
  prefixesByMediaType: ReadonlyMap<string, readonly string[]>
  now?: Date
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
    newItems: sql<number>`coalesce(sum(${listItems.isNew}), 0)`,
    timeRemainingMinutes: sql<number>`coalesce(sum(case when ${listItems.consumedAt} is null then ${listItems.timeToConsumeMinutes} else 0 end), 0)`,
    // Drizzle applies the column's timestamp mapping here, so this is already
    // a Date — do not convert it again.
    lastConsumedAt: max(listItems.consumedAt),
  }
}

type StatsRow = List & {
  totalItems: number
  consumedItems: number
  newItems: number
  timeRemainingMinutes: number
  lastConsumedAt: Date | null
}

function toListWithStats(row: StatsRow, runtimesPending = 0): ListWithStats {
  const { totalItems, consumedItems, newItems, timeRemainingMinutes, lastConsumedAt, ...list } = row

  return {
    ...list,
    stats: {
      totalItems,
      consumedItems,
      newItems: Number(newItems),
      // An empty list is 0% complete, not 100%. Nothing has been finished, and
      // calling it complete would let empty lists win "I'm tired, boss", which
      // ranks on being nearly done.
      completionPercent:
        totalItems === 0 ? 0 : Math.round((consumedItems / totalItems) * 1000) / 10,
      timeRemainingMinutes: Number(timeRemainingMinutes),
      lastConsumedAt: lastConsumedAt ?? null,
      runtimesPending,
    },
  }
}

export async function findListsWithStats(
  db: PortableDatabase,
  userId: string,
  runtimes?: RuntimeStatsOptions,
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

  const pending = runtimes
    ? await pendingCounts(db, userId, runtimes.now ?? new Date(), runtimes.prefixesByMediaType)
    : new Map<string, number>()

  return rows.map((row) => toListWithStats(row as StatsRow, pending.get(row.id) ?? 0))
}

export async function findListWithStats(
  db: PortableDatabase,
  userId: string,
  listId: string,
  runtimes?: RuntimeStatsOptions,
): Promise<ListWithStats | undefined> {
  const row = await db
    .select(statsSelection())
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .groupBy(lists.id)
    .get()

  if (!row) return undefined

  const pending = runtimes
    ? await pendingCounts(db, userId, runtimes.now ?? new Date(), runtimes.prefixesByMediaType, listId)
    : undefined

  return toListWithStats(row as StatsRow, pending?.get(listId) ?? 0)
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
/**
 * Deletes a list and hands back everything that went with it — its items,
 * groups, snapshot, dismissals and `source_yaml` — so Undo can put it all back.
 */
export async function deleteList(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ListRestore | undefined> {
  const list = await findList(db, userId, listId)
  if (!list) return undefined

  const restore: ListRestore = {
    list: toListPayload(list),
    items: (await findListItems(db, userId, listId))!.map(toItemPayload),
    groups: ((await findListGroups(db, userId, listId)) ?? []).map(toGroupPayload),
    snapshot: (await findListSnapshot(db, userId, listId)).map(toSnapshotPayload),
    dismissals: (await findDismissals(db, userId, listId)).map(toDismissalPayload),
  }

  await db.delete(lists).where(and(eq(lists.id, listId), eq(lists.userId, userId))).run()

  return restore
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
      tags: normalizeItemTags(input.tags),
      notes: input.notes ?? null,
      isNew: input.isNew ?? false,
    })
    .returning()
    .get()
}

/** Mark all seen (10.17): clears every "new" marker on a list; returns how many. */
export async function markListSeen(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<number | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const cleared = await db
    .update(listItems)
    .set({ isNew: false })
    .where(and(eq(listItems.listId, listId), eq(listItems.isNew, true)))
    .returning({ id: listItems.id })
    .all()

  return cleared.length
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

  // Tags as stored (U5): trimmed, one spelling each, none as null; absent leaves them alone.
  const tags = patch.tags === undefined ? {} : { tags: normalizeItemTags(patch.tags) }

  return await db
    .update(listItems)
    .set({ ...patch, ...group, ...tags, updatedAt: new Date() })
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
): Promise<ItemRestore | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  const deleted = await db
    .delete(listItems)
    .where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)))
    .returning()
    .all()
  const [item] = deleted
  if (!item) return undefined

  const dismissal = await db
    .insert(dismissedItems)
    .values({
      listId,
      titleKey: dismissalTitleKey(item.title),
      ...(item.externalRef ? { externalRef: item.externalRef } : {}),
    })
    .returning()
    .get()

  // Everything needed to put it back — Undo posts this to the restore route.
  return { item: toItemPayload(item), dismissalId: dismissal.id }
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
 * Rows per snapshot insert. One statement binding more than 32,766 values is refused: at 11 a row
 * that was 2,979 items, so a bigger list could be made and then fail on its source copy (BL-049).
 * 250 is also the size quickest through the desktop's SQL plugin (DECISIONS "15.9b").
 */
const SNAPSHOT_CHUNK = 250

/**
 * Writes a list's arrived-state snapshot (D4) — `source: 'api' | 'llm'`
 * lists only — in the same import that creates the list's real items. The
 * user's edits, a refresh-add and a sync leave the snapshot untouched, by
 * design, so it stays "what arrived," not "what's here now." Only the source
 * copy's own refresh (`refreshSourceCopy`, Phase 12) replaces it, and only
 * from the source, never from the user's list.
 */
export async function createListSnapshot(
  db: PortableDatabase,
  listId: string,
  items: CreateListSnapshotItemInput[],
): Promise<void> {
  for (let start = 0; start < items.length; start += SNAPSHOT_CHUNK) {
    await db
      .insert(listSnapshots)
      .values(
        items.slice(start, start + SNAPSHOT_CHUNK).map((item) => ({
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
}

/** Removes a list's arrived-state snapshot rows (the source copy's items); the list and its own items are untouched. */
export async function deleteListSnapshot(db: PortableDatabase, listId: string): Promise<void> {
  await db.delete(listSnapshots).where(eq(listSnapshots.listId, listId)).run()
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
