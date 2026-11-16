import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { runAtomically } from '../db/atomic.js'
import { listItems } from '../db/schema.js'
import { withListLock } from './listLock.js'
import { batches } from './orderIndex.js'
import { findList } from './repository.js'
import type { ConsumedRestore } from './restorePayloads.js'

/**
 * Mark many items done or not done at once (H-026, a checkbox on a group head).
 *
 * Only the items that are not already in the wanted state change: an item that is done keeps its date and
 * its updated time when "done" is asked again, and the result lists exactly the items that changed, each with
 * what it was — that is both the toast's count and what Undo puts back. Read first, written after, under the list's
 * turn; all the batches are ONE transaction (Phase 53, 53.5d), so a failure or a process that dies leaves every item as it was.
 *
 * Imported by the server's routes and by the desktop's `api.local.ts` alike; nothing here reads a Node builtin.
 */

/**
 * An Undo payload with a date that is not an ISO date this module wrote. Refused whole, before anything is written: `NaN` is stored as
 * NULL (the item would have lost its done state without a word) and a loose string such as `5` is a date in 2001. It is a 400 over HTTP
 * (Fastify sends an error's `statusCode`).
 */
export class InvalidConsumedRestoreError extends Error {
  readonly statusCode = 400

  constructor() {
    super('The Undo has a date that is not a date.')
    this.name = 'InvalidConsumedRestoreError'
  }
}

export function setItemsConsumed(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemIds: readonly string[],
  consumed: boolean,
  now: Date = new Date(),
): Promise<ConsumedRestore | undefined> {
  return withListLock(listId, () => setItemsConsumedNow(db, userId, listId, itemIds, consumed, now))
}

async function setItemsConsumedNow(
  db: PortableDatabase,
  userId: string,
  listId: string,
  itemIds: readonly string[],
  consumed: boolean,
  now: Date,
): Promise<ConsumedRestore | undefined> {
  if (!(await findList(db, userId, listId))) return undefined

  // Items that differ from the wanted state, read before anything is written.
  const differs = consumed ? isNull(listItems.consumedAt) : isNotNull(listItems.consumedAt)
  const changed: { id: string; consumedAt: Date | null }[] = []
  for (const batch of batches([...new Set(itemIds)])) {
    changed.push(
      ...(await db
        .select({ id: listItems.id, consumedAt: listItems.consumedAt })
        .from(listItems)
        .where(and(eq(listItems.listId, listId), inArray(listItems.id, batch), differs))
        .all()),
    )
  }

  // All the batches in ONE transaction (53.5d): the items change together or none does.
  await runAtomically(
    db,
    batches(changed).map((batch) =>
      db
        .update(listItems)
        .set({ consumedAt: consumed ? now : null, updatedAt: now })
        .where(and(eq(listItems.listId, listId), inArray(listItems.id, batch.map((entry) => entry.id)), differs)),
    ),
  )

  return { items: changed.map((entry) => ({ id: entry.id, consumedAt: entry.consumedAt?.toISOString() ?? null })) }
}

/** Puts each item back as a bulk mark found it, done dates included (the Undo of `setItemsConsumed`). False when the list is not the user's. */
export function restoreConsumed(
  db: PortableDatabase,
  userId: string,
  listId: string,
  restore: ConsumedRestore,
  now: Date = new Date(),
): Promise<boolean> {
  return withListLock(listId, () => restoreConsumedNow(db, userId, listId, restore, now))
}

async function restoreConsumedNow(
  db: PortableDatabase,
  userId: string,
  listId: string,
  { items }: ConsumedRestore,
  now: Date,
): Promise<boolean> {
  if (!(await findList(db, userId, listId))) return false

  // Those that were open need no dates: one statement per batch. Those that were done each have a date of their own, checked first: only the
  // ISO strings this module hands out (`toISOString`) are dates. `new Date('5')` and `new Date('2025')` are valid dates to JavaScript.
  const open = items.filter((entry) => entry.consumedAt === null)
  const done: { id: string; at: number }[] = []
  for (const entry of items) {
    if (entry.consumedAt === null) continue

    const at = Date.parse(entry.consumedAt)
    if (!Number.isFinite(at) || new Date(at).toISOString() !== entry.consumedAt) throw new InvalidConsumedRestoreError()
    done.push({ id: entry.id, at })
  }

  // All the batches in ONE transaction (53.5d): everything goes back as it was, or nothing does.
  await runAtomically(db, [
    ...batches(open).map((batch) =>
      db
        .update(listItems)
        .set({ consumedAt: null, updatedAt: now })
        .where(and(eq(listItems.listId, listId), inArray(listItems.id, batch.map((entry) => entry.id)))),
    ),
    ...batches(done).map((batch) => {
      const dates = sql`case ${listItems.id} ${sql.join(
        batch.map((entry) => sql`when ${entry.id} then ${entry.at}`),
        sql` `,
      )} end`

      return db
        .update(listItems)
        .set({ consumedAt: dates, updatedAt: now })
        .where(and(eq(listItems.listId, listId), inArray(listItems.id, batch.map((entry) => entry.id))))
    }),
  ])

  return true
}
