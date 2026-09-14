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
  /**
   * Music-only "group by type" toggle. Setting this re-lays out every
   * existing item (see `applyGroupByType` below) — `true` sorts them into
   * Album/EP/Single/Live/Compilation order and sets each item's `group`
   * from its `releaseType`; `false` restores chronological order and
   * clears `group` back to null. `undefined` leaves items untouched (every
   * other patch field).
   */
  groupByType?: boolean
}

/**
 * Which of the five type buckets an item's release-type label groups under
 * (task: "group by type" toggle) — `Compilation` and `Live` win over the
 * base type they're layered on (confirmed with the user: a Live EP groups
 * under "Live", not "EP"), matching `releaseType`'s own `'<type> ·
 * <extra>...'` shape from `musicbrainz.ts`. Null for a candidate with no
 * release-type label at all (every non-music item).
 */
export function releaseTypeBucket(releaseType: string | null | undefined): string | null {
  if (!releaseType) return null

  const facets = releaseType.split(' · ')
  if (facets.includes('Compilation')) return 'Compilation'
  if (facets.includes('Live')) return 'Live'
  return facets[0]!
}

/** Fixed top-to-bottom section order, confirmed with the user. */
const GROUP_BY_TYPE_ORDER = ['Album', 'EP', 'Single', 'Live', 'Compilation'] as const

function bucketPriority(bucket: string | null): number {
  const index = GROUP_BY_TYPE_ORDER.indexOf(bucket as (typeof GROUP_BY_TYPE_ORDER)[number])
  return index === -1 ? GROUP_BY_TYPE_ORDER.length : index
}

/**
 * Re-lays out a music list's items for the "group by type" toggle —
 * *physically* reorders them, not just a rendering-time overlay. This is
 * what makes `moveItem`/`moveItemTo` (`ListDetail.tsx`, task 6.7's
 * reordering-within-a-group boundary) work correctly here: those check the
 * *physically adjacent* item, which only lines up with the *visually*
 * adjacent one when a group is truly contiguous in storage — true for TV
 * seasons by construction, but not for music, where items stay in
 * chronological order and same-type releases are naturally interleaved by
 * release date. A view-only grouping overlay was tried first and produced
 * exactly that bug, found live: every item rendered as its own one-item
 * group, and the up/down arrows barely worked. See docs/DECISIONS.md.
 *
 * `enabled: true` sorts into `GROUP_BY_TYPE_ORDER`, chronological
 * (`year`, unknown last) within each bucket, and sets `group` from
 * `releaseTypeBucket`. `enabled: false` restores plain chronological order
 * and clears `group`. Either way, ties keep their current relative order
 * (`Array.prototype.sort` is stable) — restoring chronological order after
 * grouping is therefore only accurate to the year, having lost whatever
 * finer-grained (month/day) ordering the original chronological build had.
 * Accepted imprecision, not fixed: `list_items` has no more precise date
 * field than `year` to restore from.
 */
export async function applyGroupByType(
  db: PortableDatabase,
  userId: string,
  listId: string,
  enabled: boolean,
): Promise<void> {
  const items = (await findListItems(db, userId, listId)) ?? []

  const withGroup = items.map((item) => ({
    item,
    group: enabled ? releaseTypeBucket(item.releaseType) : null,
  }))

  withGroup.sort((a, b) => {
    if (enabled) {
      const priorityDiff = bucketPriority(a.group) - bucketPriority(b.group)
      if (priorityDiff !== 0) return priorityDiff
    }
    return (a.item.year ?? Number.MAX_SAFE_INTEGER) - (b.item.year ?? Number.MAX_SAFE_INTEGER)
  })

  // Sequential, not Promise.all — see ingestion/routes.ts's from-source
  // route for why (the proxy driver races concurrent writes).
  for (const [orderIndex, { item, group }] of withGroup.entries()) {
    if (item.orderIndex === orderIndex && item.group === group) continue

    await db
      .update(listItems)
      .set({ orderIndex, group, updatedAt: new Date() })
      .where(eq(listItems.id, item.id))
  }
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
  /** Language tag, when a language filter actually applied. Null otherwise. */
  language?: string | null
  /** Release-type label (music category only), e.g. "Album", "EP · Live". Null otherwise. */
  releaseType?: string | null
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

  const updated = await db
    .update(lists)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .returning()
    .get()

  // Bulk side effect of the "group by type" toggle — see `applyGroupByType`.
  if (patch.groupByType !== undefined) {
    await applyGroupByType(db, userId, listId, patch.groupByType)
  }

  return updated
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
      year: input.year ?? null,
      group: input.group ?? null,
      language: input.language ?? null,
      releaseType: input.releaseType ?? null,
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
