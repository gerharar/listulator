import { and, asc, eq, gte, isNotNull, max, sql } from 'drizzle-orm'
import { runAtomically } from '../db/atomic.js'
import type { PortableDatabase } from '../db/client.js'
import { dismissalTitleKey, dismissedItems, listGroups, listItems, lists, type ListGroup } from '../db/schema.js'
import { toGroupPayload, toItemPayload, type GroupRestore } from './restorePayloads.js'
import { batches, groupPositionStatements, itemPositionStatements, movedOnly, setGroupPositions } from './orderIndex.js'
import { yearSortKey } from './years.js'

/**
 * A list's groups as rows of their own (D3, task 10.16).
 *
 * A group's *name* is what its items carry in `list_items.group`; this table
 * says which groups exist (an empty one included) and in what order. Renaming
 * one relabels its items. Names are unique per list, case-insensitively, so
 * "season 1" and "Season 1" can never both exist.
 *
 * Like `repository.ts`, every function is scoped by `userId` through the list,
 * returns `undefined`/`false` for a list that is not yours, and awaits every
 * call so it runs unchanged on the desktop's async driver.
 */

/** A name that cannot be used: empty after trimming, or another group in the list already has it. */
export class GroupNameError extends Error {
  constructor(readonly reason: 'empty' | 'duplicate') {
    super(`group name is ${reason}`)
  }
}

/** Only an empty group can be deleted; its items would otherwise silently lose their group. */
export class GroupNotEmptyError extends Error {}

/** `groupIds` was not exactly this list's groups, each once. */
export class GroupReorderMismatchError extends Error {}

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

async function ownsList(db: PortableDatabase, userId: string, listId: string): Promise<boolean> {
  const row = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.userId, userId)))
    .get()

  return row !== undefined
}

export async function groupsOf(db: PortableDatabase, listId: string): Promise<ListGroup[]> {
  return await db
    .select()
    .from(listGroups)
    .where(eq(listGroups.listId, listId))
    .orderBy(asc(listGroups.orderIndex), asc(listGroups.id))
    .all()
}

export async function findListGroups(
  db: PortableDatabase,
  userId: string,
  listId: string,
): Promise<ListGroup[] | undefined> {
  if (!(await ownsList(db, userId, listId))) return undefined

  return await groupsOf(db, listId)
}

async function appendGroup(db: PortableDatabase, listId: string, name: string): Promise<ListGroup> {
  const highest = await db
    .select({ value: max(listGroups.orderIndex) })
    .from(listGroups)
    .where(eq(listGroups.listId, listId))
    .get()

  return await db
    .insert(listGroups)
    .values({ listId, name, orderIndex: (highest?.value ?? -1) + 1 })
    .returning()
    .get()
}

/** A new group, empty, at the end. Refuses an empty or already-used name. */
export async function createListGroup(
  db: PortableDatabase,
  userId: string,
  listId: string,
  name: string,
): Promise<ListGroup | undefined> {
  if (!(await ownsList(db, userId, listId))) return undefined

  const trimmed = name.trim()
  if (trimmed.length === 0) throw new GroupNameError('empty')
  if ((await groupsOf(db, listId)).some((group) => sameName(group.name, trimmed))) {
    throw new GroupNameError('duplicate')
  }

  return await appendGroup(db, listId, trimmed)
}

/**
 * The group an item's label belongs to, made at the end if the list has none
 * of that name. Returns the group's own spelling, which the item should carry.
 * Not scoped by user: it is only called for a list the caller already owns.
 */
export async function ensureListGroup(
  db: PortableDatabase,
  listId: string,
  name: string,
): Promise<ListGroup> {
  const existing = (await groupsOf(db, listId)).find((group) => sameName(group.name, name))

  return existing ?? (await appendGroup(db, listId, name.trim()))
}

export async function renameListGroup(
  db: PortableDatabase,
  userId: string,
  listId: string,
  groupId: string,
  name: string,
): Promise<ListGroup | undefined> {
  if (!(await ownsList(db, userId, listId))) return undefined

  const groups = await groupsOf(db, listId)
  const group = groups.find((entry) => entry.id === groupId)
  if (!group) return undefined

  const trimmed = name.trim()
  if (trimmed.length === 0) throw new GroupNameError('empty')
  if (groups.some((other) => other.id !== groupId && sameName(other.name, trimmed))) {
    throw new GroupNameError('duplicate')
  }

  // The items' label and the group row change in ONE transaction (53.5d): a rename that fails or is cut short changes neither.
  const results = await runAtomically(db, [
    db
      .update(listItems)
      .set({ group: trimmed, updatedAt: new Date() })
      .where(and(eq(listItems.listId, listId), eq(listItems.group, group.name))),
    db.update(listGroups).set({ name: trimmed, updatedAt: new Date() }).where(eq(listGroups.id, groupId)).returning(),
  ])

  return (results[1] as ListGroup[])[0]
}

/**
 * Deletes a group. One with items is refused unless `withItems` says to take
 * them too (owner, 2026-09-27, after a confirmation stating how many): then its
 * items go, each recorded as not wanted the way deleting an item by hand is, so
 * a refresh does not offer them back. Returns what is needed to restore it all,
 * or `undefined` when the group (or the list) is not there.
 */
export async function deleteListGroup(
  db: PortableDatabase,
  userId: string,
  listId: string,
  groupId: string,
  { withItems = false }: { withItems?: boolean } = {},
): Promise<GroupRestore | undefined> {
  if (!(await ownsList(db, userId, listId))) return undefined

  const groups = await groupsOf(db, listId)
  const group = groups.find((entry) => entry.id === groupId)
  if (!group) return undefined

  const inside = await db
    .select()
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.group, group.name)))
    .all()
  if (inside.length > 0 && !withItems) throw new GroupNotEmptyError('a group with items cannot be deleted')

  // Everything is worked out before the first write (53.5d): the dismissals' ids are made here, so the Undo's `dismissalIds` come from the
  // plan and not from what an insert answers (class (b)), and the groups after this one are renumbered from the list read above, minus
  // this one, not read again after the delete (class (c)).
  const dismissals = inside.map((item) => ({
    id: crypto.randomUUID(),
    listId,
    titleKey: dismissalTitleKey(item.title),
    ...(item.externalRef ? { externalRef: item.externalRef } : {}),
  }))
  const dismissalIds = dismissals.map((dismissal) => dismissal.id)

  // One transaction: the items, the record that they were not wanted, the group and the others' positions go together or not at all.
  // The dismissals go in batches: one statement for thousands of them is past SQLite's limit on bound values.
  await runAtomically(db, [
    ...(inside.length > 0 ? [db.delete(listItems).where(and(eq(listItems.listId, listId), eq(listItems.group, group.name)))] : []),
    ...batches(dismissals).map((batch) => db.insert(dismissedItems).values(batch)),
    db.delete(listGroups).where(eq(listGroups.id, groupId)),
    ...groupPositionStatements(db, listId, movedOnly(groups.filter((entry) => entry.id !== groupId))),
  ])

  return inside.length > 0
    ? { group: toGroupPayload(group), items: inside.map(toItemPayload), dismissalIds }
    : { group: toGroupPayload(group) }
}

/**
 * Sets the block order of the groups. The items of each group move with it,
 * into the positions grouped items already occupy; an ungrouped item never
 * moves, and the order inside a group is kept.
 */
export async function reorderListGroups(
  db: PortableDatabase,
  userId: string,
  listId: string,
  groupIds: string[],
): Promise<ListGroup[] | undefined> {
  if (!(await ownsList(db, userId, listId))) return undefined

  const groups = await groupsOf(db, listId)
  const known = new Set(groups.map((group) => group.id))
  if (
    groupIds.length !== groups.length ||
    new Set(groupIds).size !== groupIds.length ||
    !groupIds.every((id) => known.has(id))
  ) {
    throw new GroupReorderMismatchError("groupIds must be exactly this list's groups, each once")
  }

  // What the items need is read BEFORE anything is written (it does not depend on the group rows' positions), so the whole move is one
  // list of statements, run in ONE transaction (53.5c).
  const rankByName = new Map(
    groupIds.map((id, index) => [groups.find((group) => group.id === id)!.name, index] as const),
  )
  const grouped = (
    await db
      .select()
      .from(listItems)
      .where(and(eq(listItems.listId, listId), isNotNull(listItems.group)))
      .orderBy(asc(listItems.orderIndex), asc(listItems.id))
      .all()
  ).filter((item) => item.group !== '')

  const slots = grouped.map((item) => item.orderIndex)
  const sequence = [...grouped].sort(
    (a, b) =>
      (rankByName.get(a.group!) ?? Infinity) - (rankByName.get(b.group!) ?? Infinity) ||
      a.orderIndex - b.orderIndex,
  )

  await runAtomically(db, [
    ...groupPositionStatements(db, listId, groupIds.map((id, index) => ({ id, orderIndex: index }))),
    ...itemPositionStatements(
      db,
      listId,
      sequence
        .map((item, position) => ({ id: item.id, from: item.orderIndex, orderIndex: slots[position]! }))
        .filter((move) => move.from !== move.orderIndex),
      { touch: new Date() },
    ),
  ])

  // The answer is read after the commit.
  return await groupsOf(db, listId)
}

/**
 * Orders a list's groups by the earliest year among their items, once, at
 * import (D3): groups with the same or no years keep the order they first
 * appeared in. Never re-run afterwards, and it moves no item.
 */
export async function seedGroupOrder(db: PortableDatabase, listId: string): Promise<void> {
  const groups = await groupsOf(db, listId)
  const dated = await db
    .select({ group: listItems.group, year: listItems.year, yearUnk: listItems.yearUnk })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), isNotNull(listItems.group), isNotNull(listItems.year)))
    .all()

  await setGroupPositions(db, listId, seedGroupPositions(groups, dated))
}

/**
 * The groups a set of items needs that a list does not have yet, worked out from what is given instead of read (what `ensureListGroup` finds
 * or makes, item by item, in the order the labels first appear): a label the list already spells, in any case, is not made again, and a
 * new group goes after the last one, named as its label trimmed.
 */
export function missingGroups(
  existing: readonly { name: string; orderIndex: number }[],
  items: readonly { group: string | null; orderIndex: number }[],
): { name: string; orderIndex: number }[] {
  const names = existing.map((group) => group.name)
  let next = existing.reduce((top, group) => Math.max(top, group.orderIndex), -1) + 1
  const made: { name: string; orderIndex: number }[] = []
  const seen = new Set<string>()

  for (const item of [...items].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (!item.group || seen.has(item.group)) continue
    seen.add(item.group)
    if (names.some((name) => sameName(name, item.group!))) continue

    const name = item.group.trim()
    names.push(name)
    made.push({ name, orderIndex: next++ })
  }

  return made
}

/**
 * Where `seedGroupOrder` puts the groups, worked out from what is given instead of read: `groups` in the order they stand (by position,
 * then id) and the items that carry a group and a year. A rewrite that has just planned its groups and items has both in memory and can
 * ask for the positions before anything is written (Phase 53: no read between the writes of one transaction).
 */
export function seedGroupPositions(
  groups: readonly { id: string; name: string; orderIndex: number }[],
  items: readonly { group: string | null; year: number | null; yearUnk: number | null }[],
): { id: string; orderIndex: number }[] {
  // By the same key as Sort by release date, so a group with only `199?` in it is placed as late as 1999 (H-005).
  const earliest = new Map<string, number>()
  for (const row of items) {
    if (row.group === null || row.year === null) continue
    const key = yearSortKey({ year: row.year, yearUnk: row.yearUnk ?? 0 })
    if (key < (earliest.get(row.group) ?? Infinity)) earliest.set(row.group, key)
  }

  const sorted = [...groups].sort((a, b) => (earliest.get(a.name) ?? Infinity) - (earliest.get(b.name) ?? Infinity))

  return movedOnly(sorted)
}

/**
 * Where a new item in `group` goes: straight after that group's last item,
 * with everything after it moved down one so the group stays contiguous
 * (BL-003). A group with no items yet, or no group at all, means the end of
 * the list.
 */
export async function placeNewItem(
  db: PortableDatabase,
  listId: string,
  group: string | null,
): Promise<number> {
  const endOfList = async (): Promise<number> => {
    const highest = await db
      .select({ value: max(listItems.orderIndex) })
      .from(listItems)
      .where(eq(listItems.listId, listId))
      .get()

    return (highest?.value ?? -1) + 1
  }

  if (!group) return await endOfList()

  const last = await db
    .select({ value: max(listItems.orderIndex) })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.group, group)))
    .get()
  if (last?.value === null || last?.value === undefined) return await endOfList()

  const position = last.value + 1
  await db
    .update(listItems)
    .set({ orderIndex: sql`${listItems.orderIndex} + 1` })
    .where(and(eq(listItems.listId, listId), gte(listItems.orderIndex, position)))
    .run()

  return position
}
