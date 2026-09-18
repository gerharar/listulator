import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { listItems, lists, users } from './schema.js'

/**
 * Schema-level round-trip for `list_items.tags` (SPEC.md §4) — additive-only
 * migration, no consumer wired up yet, so this exercises the column directly
 * through Drizzle rather than through `repository.ts`.
 */
describe('list_items.tags', () => {
  let harness: TestApp
  let userId: string
  let listId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()

    userId = harness.db.select().from(users).get()!.id
    listId = harness.db
      .insert(lists)
      .values({ userId, title: 'Some Band — Discography', mediaType: 'music' })
      .returning()
      .get().id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('round-trips an array of tag strings as JSON', () => {
    const item = harness.db
      .insert(listItems)
      .values({
        listId,
        title: 'Global Evisceration',
        orderIndex: 0,
        timeToConsumeMinutes: 45,
        tags: ['Album', 'Live'],
      })
      .returning()
      .get()

    expect(item.tags).toEqual(['Album', 'Live'])

    const reloaded = harness.db.select().from(listItems).where(eq(listItems.id, item.id)).get()!
    expect(reloaded.tags).toEqual(['Album', 'Live'])
  })

  it('defaults to null when omitted', () => {
    const item = harness.db
      .insert(listItems)
      .values({ listId, title: 'Eaten Back to Life', orderIndex: 0, timeToConsumeMinutes: 45 })
      .returning()
      .get()

    expect(item.tags).toBeNull()
  })
})
