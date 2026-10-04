import { and, asc, eq, getTableColumns, isNull } from 'drizzle-orm'
import { findListsWithStats, type ListWithStats } from '../catalog/repository.js'
import type { PortableDatabase } from '../db/client.js'
import { listItems, lists, type ListItem } from '../db/schema.js'

/** What `rank` needs besides the strategy: the reader's lists, and each one's unconsumed items in order. */
export interface RankingInputs {
  candidates: ListWithStats[]
  /** Every candidate's unconsumed items, in list order; an empty array for a list with none left. */
  unconsumed: Map<string, ListItem[]>
  /** The first of them: the next thing to do on that list. */
  nextItems: Map<string, ListItem | undefined>
}

/**
 * Loads them in two queries, the lists with their stats and every unconsumed item of the reader's: it was two
 * queries per list (review 2026-10-04), and the server's route and the desktop's `api.local.ts` each wrote it out.
 * Every item still comes back, as an item strategy (Just One Fix) ranks all of them.
 */
export async function loadRankingInputs(db: PortableDatabase, userId: string): Promise<RankingInputs> {
  const candidates = await findListsWithStats(db, userId)

  const rows = await db
    .select(getTableColumns(listItems))
    .from(listItems)
    .innerJoin(lists, eq(lists.id, listItems.listId))
    .where(and(eq(lists.userId, userId), isNull(listItems.consumedAt)))
    .orderBy(asc(listItems.listId), asc(listItems.orderIndex), asc(listItems.id))
    .all()

  const unconsumed = new Map<string, ListItem[]>(candidates.map((list) => [list.id, []]))
  for (const item of rows) unconsumed.get(item.listId)?.push(item)

  const nextItems = new Map<string, ListItem | undefined>(
    [...unconsumed].map(([listId, items]) => [listId, items[0]] as const),
  )

  return { candidates, unconsumed, nextItems }
}
