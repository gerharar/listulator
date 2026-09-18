import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { backfillLegacyTags } from './backfillLegacyTags.js'
import { listItems, lists, users } from './schema.js'

/**
 * One-time data migration (tasks/todo.md, Phase 8 task 10) — folds the
 * still-present `release_type`/`language` columns into `tags` for rows that
 * predate the `tags` field, and clears stale `group` residue left by the
 * retired "group by type" toggle. Must run, and be confirmed correct,
 * against every real database (including the desktop app's) before the
 * column-dropping migration ever ships — that migration cannot recover
 * data these columns still hold.
 */
describe('backfillLegacyTags', () => {
  let harness: TestApp
  let userId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    userId = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('folds a legacy releaseType into tags, splitting on every facet', async () => {
    const list = harness.db.insert(lists).values({ userId, title: 'Band', mediaType: 'music' }).returning().get()

    const single = harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'A', orderIndex: 0, timeToConsumeMinutes: 45, releaseType: 'Album' })
      .returning()
      .get()
    const double = harness.db
      .insert(listItems)
      .values({
        listId: list.id,
        title: 'B',
        orderIndex: 1,
        timeToConsumeMinutes: 45,
        releaseType: 'Album · Live',
      })
      .returning()
      .get()
    const triple = harness.db
      .insert(listItems)
      .values({
        listId: list.id,
        title: 'C',
        orderIndex: 2,
        timeToConsumeMinutes: 45,
        releaseType: 'Album · Live · Compilation',
      })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)

    expect(harness.db.select().from(listItems).where(eq(listItems.id, single.id)).get()!.tags).toEqual([
      'Album',
    ])
    expect(harness.db.select().from(listItems).where(eq(listItems.id, double.id)).get()!.tags).toEqual([
      'Album',
      'Live',
    ])
    expect(harness.db.select().from(listItems).where(eq(listItems.id, triple.id)).get()!.tags).toEqual([
      'Album',
      'Live',
      'Compilation',
    ])
  })

  it('folds a legacy language into tags as its human-readable label', async () => {
    const list = harness.db.insert(lists).values({ userId, title: 'Author', mediaType: 'book' }).returning().get()

    const known = harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'X', orderIndex: 0, timeToConsumeMinutes: 240, language: 'jpn' })
      .returning()
      .get()
    const unknown = harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'Y', orderIndex: 1, timeToConsumeMinutes: 240, language: 'unknown' })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)

    expect(harness.db.select().from(listItems).where(eq(listItems.id, known.id)).get()!.tags).toEqual([
      'Japanese',
    ])
    expect(harness.db.select().from(listItems).where(eq(listItems.id, unknown.id)).get()!.tags).toEqual([
      'Unknown',
    ])
  })

  it('never overwrites tags a row already has', async () => {
    const list = harness.db.insert(lists).values({ userId, title: 'Band', mediaType: 'music' }).returning().get()

    const item = harness.db
      .insert(listItems)
      .values({
        listId: list.id,
        title: 'A',
        orderIndex: 0,
        timeToConsumeMinutes: 45,
        releaseType: 'Album',
        tags: ['Album'],
      })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)

    expect(harness.db.select().from(listItems).where(eq(listItems.id, item.id)).get()!.tags).toEqual([
      'Album',
    ])
  })

  it('leaves an item with neither releaseType, language, nor tags untouched', async () => {
    const list = harness.db.insert(lists).values({ userId, title: 'Show', mediaType: 'tv' }).returning().get()
    const item = harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'Pilot', orderIndex: 0, timeToConsumeMinutes: 25, group: 'Season 1' })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)

    const reloaded = harness.db.select().from(listItems).where(eq(listItems.id, item.id)).get()!
    expect(reloaded.tags).toBeNull()
    expect(reloaded.group).toBe('Season 1')
  })

  it('clears group on every item of a list where "group by type" was left on, leaves other lists alone', async () => {
    const groupedList = harness.db
      .insert(lists)
      .values({ userId, title: 'Band A', mediaType: 'music', groupByType: true })
      .returning()
      .get()
    const groupedItem = harness.db
      .insert(listItems)
      .values({ listId: groupedList.id, title: 'A', orderIndex: 0, timeToConsumeMinutes: 45, group: 'Album' })
      .returning()
      .get()

    const seasonList = harness.db.insert(lists).values({ userId, title: 'Show', mediaType: 'tv' }).returning().get()
    const seasonItem = harness.db
      .insert(listItems)
      .values({ listId: seasonList.id, title: 'Pilot', orderIndex: 0, timeToConsumeMinutes: 25, group: 'Season 1' })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)

    expect(harness.db.select().from(listItems).where(eq(listItems.id, groupedItem.id)).get()!.group).toBeNull()
    expect(harness.db.select().from(listItems).where(eq(listItems.id, seasonItem.id)).get()!.group).toBe(
      'Season 1',
    )
  })

  it('is idempotent — running it twice changes nothing the second time', async () => {
    const list = harness.db
      .insert(lists)
      .values({ userId, title: 'Band', mediaType: 'music', groupByType: true })
      .returning()
      .get()
    const item = harness.db
      .insert(listItems)
      .values({
        listId: list.id,
        title: 'A',
        orderIndex: 0,
        timeToConsumeMinutes: 45,
        releaseType: 'Album · Live',
        group: 'Album',
      })
      .returning()
      .get()

    await backfillLegacyTags(harness.db)
    const first = harness.db.select().from(listItems).where(eq(listItems.id, item.id)).get()!

    await backfillLegacyTags(harness.db)
    const second = harness.db.select().from(listItems).where(eq(listItems.id, item.id)).get()!

    expect(second).toEqual(first)
    expect(first.tags).toEqual(['Album', 'Live'])
    expect(first.group).toBeNull()
  })

  it('reports how many items were tagged and how many groups were cleared', async () => {
    const list = harness.db
      .insert(lists)
      .values({ userId, title: 'Band', mediaType: 'music', groupByType: true })
      .returning()
      .get()
    harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'A', orderIndex: 0, timeToConsumeMinutes: 45, releaseType: 'Album' })
      .run()
    harness.db
      .insert(listItems)
      .values({ listId: list.id, title: 'B', orderIndex: 1, timeToConsumeMinutes: 45, releaseType: 'EP' })
      .run()

    const result = await backfillLegacyTags(harness.db)

    expect(result).toEqual({ itemsTagged: 2, groupsCleared: 2 })
  })
})
