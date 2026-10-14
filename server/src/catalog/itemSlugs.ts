import { and, eq, isNotNull, notExists, or, sql } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { itemSlugs, listItems } from '../db/schema.js'

/**
 * The cache of page slugs (H-002, BL-087; `item_slugs`, see its comment in `db/schema.ts`). Like the runtime cache
 * it is keyed by the source ref and not by list, holds a public fact, and is only called for a list the caller
 * already owns. Everything here is bounded by the list's own items and works in chunks: a list of ten thousand
 * games asks a handful of statements, never one per item.
 */

/** Rows per statement: SQLite refuses one binding more than 32,766 values (see `runtimes.ts`, BL-049). */
const CHUNK = 500

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = []
  for (let start = 0; start < items.length; start += CHUNK) out.push(items.slice(start, start + CHUNK))

  return out
}

export interface SlugRow {
  ref: string
  /** Null: the source was asked and has no page slug for it. */
  slug: string | null
}

/** Remembers answers, replacing any earlier one for the same ref. */
export async function recordSlugs(db: PortableDatabase, rows: readonly SlugRow[], now: Date): Promise<void> {
  for (const batch of chunks(rows)) {
    await db
      .insert(itemSlugs)
      .values(batch.map((row) => ({ ref: row.ref, slug: row.slug, fetchedAt: now })))
      .onConflictDoUpdate({
        target: itemSlugs.ref,
        set: { slug: sql`excluded.slug`, fetchedAt: sql`excluded.fetched_at` },
      })
      .run()
  }
}

/**
 * The answers held for a list's items, by ref: one query joined on the list's own items, so it costs the same
 * whatever the table holds. A slug, or null for "the source has none"; a ref with no answer is absent.
 */
export async function slugsForList(db: PortableDatabase, listId: string): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ ref: itemSlugs.ref, slug: itemSlugs.slug })
    .from(itemSlugs)
    .innerJoin(listItems, eq(listItems.externalRef, itemSlugs.ref))
    .where(eq(listItems.listId, listId))
    .all()

  return new Map(rows.map((row) => [row.ref, row.slug]))
}

/**
 * The refs of a list, of one of `prefixes`, that have no answer yet: in list order, each once. What is still to
 * look up, worked out from the data, so a restart needs no saved job.
 */
export async function missingSlugRefs(db: PortableDatabase, listId: string, prefixes: readonly string[]): Promise<string[]> {
  if (prefixes.length === 0) return []

  const rows = await db
    .select({ ref: listItems.externalRef })
    .from(listItems)
    .where(
      and(
        eq(listItems.listId, listId),
        isNotNull(listItems.externalRef),
        // The whole prefix and its colon, not a LIKE: `game` must not match `games:`.
        or(...prefixes.map((prefix) => sql`substr(${listItems.externalRef}, 1, ${prefix.length + 1}) = ${`${prefix}:`}`)),
        notExists(db.select({ one: sql`1` }).from(itemSlugs).where(eq(itemSlugs.ref, listItems.externalRef))),
      ),
    )
    .orderBy(listItems.orderIndex, listItems.id)
    .all()

  return [...new Set(rows.map((row) => row.ref!))]
}

/** For a caller that already holds a list's items and its answers: the refs of `prefixes` still unanswered, once each. */
export function unansweredRefs(
  items: readonly { externalRef: string | null }[],
  answers: ReadonlyMap<string, string | null>,
  prefixes: readonly string[],
): string[] {
  const wanted = new Set<string>()
  for (const { externalRef } of items) {
    if (externalRef && !answers.has(externalRef) && prefixes.some((prefix) => externalRef.startsWith(`${prefix}:`))) wanted.add(externalRef)
  }

  return [...wanted]
}
