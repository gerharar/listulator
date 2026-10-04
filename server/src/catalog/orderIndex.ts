import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { PortableDatabase } from '../db/client.js'
import { listGroups, listItems } from '../db/schema.js'

/**
 * Sets the positions of many rows at once: one `UPDATE … SET order_index = CASE id WHEN … END` per batch, rather
 * than a statement per row (review 2026-10-04). A drag on a list of 10,000 items was 10,000 statements, each its
 * own commit, and on the desktop each a round trip to the SQL plugin. A batch is also atomic on its own, which is
 * as close to "all or nothing" as the desktop driver allows (no transactions, DECISIONS 10.16).
 */
export interface Position {
  id: string
  orderIndex: number
}

/** Three bound values a row (the `WHEN`, the `THEN`, the `IN`): far under SQLite's limit. */
const BATCH = 500

function batches<T>(rows: readonly T[]): T[][] {
  const result: T[][] = []
  for (let start = 0; start < rows.length; start += BATCH) result.push(rows.slice(start, start + BATCH))
  return result
}

function positionCase(id: SQLiteColumn, rows: readonly Position[]): SQL {
  return sql`case ${id} ${sql.join(
    rows.map((row) => sql`when ${row.id} then ${row.orderIndex}`),
    sql` `,
  )} end`
}

/** Rows in the order they should take, as the positions of only those not already at their index. */
export function movedOnly(rows: readonly Position[]): Position[] {
  return rows.flatMap((row, index) => (row.orderIndex === index ? [] : [{ id: row.id, orderIndex: index }]))
}

/** Moves a list's items to the positions given; rows of another list are never touched. `touch` also stamps `updated_at`. */
export async function setItemPositions(
  db: PortableDatabase,
  listId: string,
  positions: readonly Position[],
  { touch }: { touch?: Date } = {},
): Promise<void> {
  for (const batch of batches(positions)) {
    await db
      .update(listItems)
      .set({ orderIndex: positionCase(listItems.id, batch), ...(touch ? { updatedAt: touch } : {}) })
      .where(and(eq(listItems.listId, listId), inArray(listItems.id, batch.map((row) => row.id))))
      .run()
  }
}

/** As `setItemPositions`, for a list's groups. */
export async function setGroupPositions(db: PortableDatabase, listId: string, positions: readonly Position[]): Promise<void> {
  for (const batch of batches(positions)) {
    await db
      .update(listGroups)
      .set({ orderIndex: positionCase(listGroups.id, batch) })
      .where(and(eq(listGroups.listId, listId), inArray(listGroups.id, batch.map((row) => row.id))))
      .run()
  }
}
