import { and, count, eq, gt, inArray, isNotNull, lte, notExists, or, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { itemRuntimes, listItems, lists, listSnapshots } from '../db/schema.js'

/**
 * The shared store of looked-up item lengths (task 15.3, `item_runtimes`), and
 * what a list does with them. The table is a cache of a source's answers, keyed
 * by the item's source ref and not by list: see its comment in `db/schema.ts`.
 *
 * Nothing here is `user_id`-scoped, for the same reason the table is not; the
 * two list-facing functions, `pendingFor` and `applyRuntimes`, are only called
 * for a list the caller already owns (as `ensureListGroup` is).
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Rows per statement. SQLite refuses a statement binding more than 32,766
 * values, and a longer one is slower per row through the desktop's SQL plugin
 * (DECISIONS "15.0", BL-049): a lookup of thousands of refs goes in chunks.
 */
const CHUNK = 500

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK))

  return out
}

export interface RuntimeRow {
  ref: string
  /** Null: the source was asked and has no length for it. */
  minutes: number | null
}

/**
 * Remembers answers, replacing any earlier one for the same ref. They lapse
 * `ttlDays` after `now`: a caller passes `refreshAfterDays(sourceCopyMaxDays)`,
 * so 150 days for TMDB, which may not be kept past 180.
 */
export async function recordRuntimes(
  db: PortableDatabase,
  rows: readonly RuntimeRow[],
  { now, ttlDays }: { now: Date; ttlDays: number },
): Promise<void> {
  const expiresAt = new Date(now.getTime() + ttlDays * DAY_MS)

  for (const batch of chunks(rows)) {
    await db
      .insert(itemRuntimes)
      .values(batch.map((row) => ({ ref: row.ref, minutes: row.minutes, fetchedAt: now, expiresAt })))
      .onConflictDoUpdate({
        target: itemRuntimes.ref,
        set: {
          minutes: sql`excluded.minutes`,
          fetchedAt: sql`excluded.fetched_at`,
          expiresAt: sql`excluded.expires_at`,
        },
      })
      .run()
  }
}

/**
 * The live answers among `refs`: a length, or null for "the source has none". A
 * ref with no live answer is absent (never asked, or the answer has lapsed).
 */
export async function knownRuntimes(
  db: PortableDatabase,
  refs: readonly string[],
  now: Date,
): Promise<Map<string, number | null>> {
  const known = new Map<string, number | null>()

  for (const batch of chunks([...new Set(refs)])) {
    const found = await db
      .select({ ref: itemRuntimes.ref, minutes: itemRuntimes.minutes })
      .from(itemRuntimes)
      .where(and(inArray(itemRuntimes.ref, batch), gt(itemRuntimes.expiresAt, now)))
      .all()

    for (const row of found) known.set(row.ref, row.minutes)
  }

  return known
}

/** Deletes the answers that have lapsed; returns how many. */
export async function pruneExpiredRuntimes(db: PortableDatabase, now: Date): Promise<number> {
  const deleted = await db
    .delete(itemRuntimes)
    .where(lte(itemRuntimes.expiresAt, now))
    .returning({ ref: itemRuntimes.ref })
    .all()

  return deleted.length
}

/**
 * Listed items given the length already known for their ref, so a list built
 * from a listing starts with every film some earlier list has looked up. An
 * item that has a length of its own keeps it; one the source has no length for
 * (null) or nothing is known about stays without, for the caller to mark
 * estimated. Pure: returns new items.
 */
export function withKnownRuntimes<T extends { externalRef?: string; timeToConsumeMinutes?: number }>(
  items: readonly T[],
  known: ReadonlyMap<string, number | null>,
): T[] {
  return items.map((item) => {
    const minutes = item.externalRef ? known.get(item.externalRef) : undefined

    return item.timeToConsumeMinutes === undefined && typeof minutes === 'number'
      ? { ...item, timeToConsumeMinutes: minutes }
      : item
  })
}

/** Items whose length is an estimate and whose ref is of one of `prefixes`, as filter conditions. */
function estimatedOf(prefixes: readonly string[]) {
  return [
    eq(listItems.timeToConsumeIsEstimated, true),
    isNotNull(listItems.externalRef),
    // The whole prefix and its colon, not a LIKE: `movie` must not match `movies:`.
    or(
      ...prefixes.map((prefix) => sql`substr(${listItems.externalRef}, 1, ${prefix.length + 1}) = ${`${prefix}:`}`),
    ),
  ]
}

/**
 * The refs of a list whose length is still an estimate and that an adapter can
 * look up (`prefixes`), in list order, each once. Whether the table already has
 * an answer is another question: see `pendingFor`.
 */
export async function estimatedRefsFor(
  db: PortableDatabase,
  listId: string,
  prefixes: readonly string[],
): Promise<string[]> {
  if (prefixes.length === 0) return []

  const rows = await db
    .select({ ref: listItems.externalRef })
    .from(listItems)
    .where(and(eq(listItems.listId, listId), ...estimatedOf(prefixes)))
    .orderBy(listItems.orderIndex, listItems.id)
    .all()

  return [...new Set(rows.map((row) => row.ref!))]
}

/**
 * The refs of a list still to look up, in list order, each once: estimated
 * items with a ref of one of `prefixes` (the kinds of ref an adapter can
 * enrich: `movie`) and no live answer in the table. A null answer counts as an
 * answer. This is the whole of "what is pending", worked out from the data, so
 * a restart needs no saved job.
 */
export async function pendingFor(
  db: PortableDatabase,
  listId: string,
  now: Date,
  prefixes: readonly string[],
): Promise<string[]> {
  if (prefixes.length === 0) return []

  const rows = await db
    .select({ ref: listItems.externalRef })
    .from(listItems)
    .where(
      and(
        eq(listItems.listId, listId),
        ...estimatedOf(prefixes),
        notExists(
          db
            .select({ one: sql`1` })
            .from(itemRuntimes)
            .where(and(eq(itemRuntimes.ref, listItems.externalRef), gt(itemRuntimes.expiresAt, now))),
        ),
      ),
    )
    .orderBy(listItems.orderIndex, listItems.id)
    .all()

  return [...new Set(rows.map((row) => row.ref!))]
}

/**
 * How many items of each of a user's lists are still waiting for a length, for the list stats (15.5):
 * the same test as `pendingFor`, counted per list in one grouped query for each distinct set of ref kinds
 * (`prefixesByMediaType`: which categories can look up which kinds, from `enrichPrefixesByMediaType`),
 * not one query per list. A list with nothing pending, or in a category that cannot look anything up,
 * is absent. `listId` narrows it to one list.
 */
export async function pendingCounts(
  db: PortableDatabase,
  userId: string,
  now: Date,
  prefixesByMediaType: ReadonlyMap<string, readonly string[]>,
  listId?: string,
): Promise<Map<string, number>> {
  // Categories that share a set of ref kinds share a query.
  const bySignature = new Map<string, { prefixes: readonly string[]; mediaTypes: string[] }>()
  for (const [mediaType, prefixes] of prefixesByMediaType) {
    if (prefixes.length === 0) continue
    const signature = [...prefixes].sort().join('|')
    const group = bySignature.get(signature) ?? { prefixes, mediaTypes: [] }
    group.mediaTypes.push(mediaType)
    bySignature.set(signature, group)
  }

  const counts = new Map<string, number>()

  for (const { prefixes, mediaTypes } of bySignature.values()) {
    const rows = await db
      .select({ listId: listItems.listId, pending: count(listItems.id) })
      .from(listItems)
      .innerJoin(lists, eq(lists.id, listItems.listId))
      .where(
        and(
          eq(lists.userId, userId),
          inArray(lists.mediaType, mediaTypes),
          ...(listId ? [eq(lists.id, listId)] : []),
          ...estimatedOf(prefixes),
          notExists(
            db
              .select({ one: sql`1` })
              .from(itemRuntimes)
              .where(and(eq(itemRuntimes.ref, listItems.externalRef), gt(itemRuntimes.expiresAt, now))),
          ),
        ),
      )
      .groupBy(listItems.listId)
      .all()

    for (const row of rows) counts.set(row.listId, row.pending)
  }

  return counts
}

/**
 * Writes looked-up lengths into a list's items and its source copy, for the
 * items whose length is still an estimate: a time the user set (or one already
 * filled in) is never overwritten, including after they edit it. Marks what it
 * sets as known. Returns how many of the list's items changed. A system fill is
 * not an edit, so it leaves `updated_at` alone.
 */
export async function applyRuntimes(
  db: PortableDatabase,
  listId: string,
  rows: readonly { ref: string; minutes: number }[],
): Promise<number> {
  let changed = 0

  for (const { ref, minutes } of rows) {
    const set = { timeToConsumeMinutes: minutes, timeToConsumeIsEstimated: false }

    const updated = await db
      .update(listItems)
      .set(set)
      .where(
        and(
          eq(listItems.listId, listId),
          eq(listItems.externalRef, ref),
          eq(listItems.timeToConsumeIsEstimated, true),
        ),
      )
      .returning({ id: listItems.id })
      .all()
    changed += updated.length

    await db
      .update(listSnapshots)
      .set(set)
      .where(
        and(
          eq(listSnapshots.listId, listId),
          eq(listSnapshots.externalRef, ref),
          eq(listSnapshots.timeToConsumeIsEstimated, true),
        ),
      )
      .run()
  }

  return changed
}
