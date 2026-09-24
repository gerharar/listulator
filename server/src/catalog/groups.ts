import { and, asc, eq, gte, isNotNull, max, min, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { listGroups, listItems, lists, type ListGroup } from '../db/schema.js'

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

async function groupsOf(db: PortableDatabase, listId: string): Promise<ListGroup[]> {
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

  // Items first, the group row last: the desktop driver has no reliable
  // transaction (docs/DECISIONS.md, 10.16), and this order leaves a failure
  // between the two as "items already relabelled", which a re-run finishes.
  await db
    .update(listItems)
    .set({ group: trimmed, updatedAt: new Date() })
    .where(and(eq(listItems.listId, listId), eq(listItems.group, group.name)))
    .run()

  return await db
    .update(listGroups)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(listGroups.id, groupId))
    .returning()
    .get()
}

async function renumberGroups(db: PortableDatabase, listId: string): Promise<void> {
  for (const [index, group] of (await groupsOf(db, listId)).entries()) {
    if (group.orderIndex !== index) {
      await db.update(listGroups).set({ orderIndex: index }).where(eq(listGroups.id, group.id)).run()
    }
  }
}

/** Empty groups only. Returns false when the group (or the list) is not there. */
export async function deleteListGroup(
  db: PortableDatabase,
  userId: string,
  listId: string,
  groupId: string,
): Promise<boolean> {
  if (!(await ownsList(db, userId, listId))) return false

  const group = (await groupsOf(db, listId)).find((entry) => entry.id === groupId)
  if (!group) return false

  const inside = await db
    .select({ id: listItems.id })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), eq(listItems.group, group.name)))
    .get()
  if (inside) throw new GroupNotEmptyError('a group with items cannot be deleted')

  await db.delete(listGroups).where(eq(listGroups.id, groupId)).run()
  await renumberGroups(db, listId)

  return true
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

  for (const [index, id] of groupIds.entries()) {
    await db.update(listGroups).set({ orderIndex: index }).where(eq(listGroups.id, id)).run()
  }

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

  for (const [position, item] of sequence.entries()) {
    if (item.orderIndex !== slots[position]) {
      await db
        .update(listItems)
        .set({ orderIndex: slots[position]!, updatedAt: new Date() })
        .where(eq(listItems.id, item.id))
        .run()
    }
  }

  return await groupsOf(db, listId)
}

/**
 * Orders a list's groups by the earliest year among their items, once, at
 * import (D3): groups with the same or no years keep the order they first
 * appeared in. Never re-run afterwards, and it moves no item.
 */
export async function seedGroupOrder(db: PortableDatabase, listId: string): Promise<void> {
  const groups = await groupsOf(db, listId)
  const earliest = new Map(
    (
      await db
        .select({ name: listItems.group, year: min(listItems.year) })
        .from(listItems)
        .where(and(eq(listItems.listId, listId), isNotNull(listItems.group)))
        .groupBy(listItems.group)
        .all()
    ).map((row) => [row.name, row.year] as const),
  )

  const sorted = [...groups].sort(
    (a, b) => (earliest.get(a.name) ?? Infinity) - (earliest.get(b.name) ?? Infinity),
  )

  for (const [index, group] of sorted.entries()) {
    if (group.orderIndex !== index) {
      await db.update(listGroups).set({ orderIndex: index }).where(eq(listGroups.id, group.id)).run()
    }
  }
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
