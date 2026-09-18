import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { loadConfig, loadEnvFile } from '../config.js'
import { languageTagLabel } from '../ingestion/adapters/openLibrary.js'
import { createDatabase, type PortableDatabase } from './client.js'
import { listItems, lists } from './schema.js'

export interface BackfillResult {
  itemsTagged: number
  groupsCleared: number
}

/**
 * One-time data migration (tasks/todo.md, Phase 8 task 10) for every
 * database this app has ever run against, including the desktop app's real
 * one — must run, and be confirmed correct, before the migration that drops
 * `release_type`/`language`/`group_by_type` ever ships. Once those columns
 * are gone this function can no longer read what it needs to fold; there is
 * no recovering from running the drop first.
 *
 * Idempotent by construction: only touches rows with `tags IS NULL` (a row
 * dual-emitting both `tags` and the legacy field already has the right
 * `tags`, from tasks 4/5, and is left alone), and re-clearing an
 * already-null `group` is a no-op. Safe to run more than once, including
 * against a database that has already been migrated.
 */
export async function backfillLegacyTags(db: PortableDatabase): Promise<BackfillResult> {
  const groupByTypeLists = await db.select({ id: lists.id }).from(lists).where(eq(lists.groupByType, true)).all()
  const groupByTypeListIds = groupByTypeLists.map((list) => list.id)

  const groupsCleared = groupByTypeListIds.length
    ? (
        await db
          .update(listItems)
          .set({ group: null })
          .where(inArray(listItems.listId, groupByTypeListIds))
          .returning()
          .all()
      ).length
    : 0

  const legacyItems = await db
    .select()
    .from(listItems)
    .where(and(isNull(listItems.tags), or(isNotNull(listItems.releaseType), isNotNull(listItems.language))))
    .all()

  // Sequential, not Promise.all — see catalog/repository.ts's own writes for
  // why (the proxy driver races concurrent writes).
  for (const item of legacyItems) {
    const tags = item.releaseType ? item.releaseType.split(' · ') : [languageTagLabel(item.language!)]

    await db.update(listItems).set({ tags }).where(eq(listItems.id, item.id))
  }

  return { itemsTagged: legacyItems.length, groupsCleared }
}

async function main(): Promise<void> {
  loadEnvFile()
  const config = loadConfig()
  const { db, close } = createDatabase(config.databasePath)

  const result = await backfillLegacyTags(db)
  close()

  console.log(
    `${config.databasePath}: tagged ${result.itemsTagged} item(s), cleared group on ${result.groupsCleared} item(s).`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
