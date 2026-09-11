import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import {
  createList,
  createListItem,
  findListWithStats,
  findListsWithStats,
  setListItemConsumed,
} from './repository.js'

describe('derived list stats', () => {
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

  /** Builds a list of `durations`, consuming the ones whose index is listed. */
  async function listWith(durations: number[], consumedIndexes: number[] = [], consumedAt?: Date) {
    const list = await createList(harness.db, userId, { title: 'Test', mediaType: 'movie' })

    for (const [index, minutes] of durations.entries()) {
      const item = (await createListItem(harness.db, userId, list.id, {
        title: `Item ${index}`,
        timeToConsumeMinutes: minutes,
      }))!

      if (consumedIndexes.includes(index)) {
        await setListItemConsumed(harness.db, userId, list.id, item.id, true, consumedAt)
      }
    }

    return list
  }

  it('computes counts, percentage and remaining time for a partly finished list', async () => {
    // 4 items totalling 400 minutes; two consumed (100 + 60), leaving 90 + 150.
    const list = await listWith([100, 90, 60, 150], [0, 2])

    expect((await findListWithStats(harness.db, userId, list.id))?.stats).toMatchObject({
      totalItems: 4,
      consumedItems: 2,
      completionPercent: 50,
      timeRemainingMinutes: 240,
    })
  })

  it('reports an empty list as 0% complete, not 100%', async () => {
    // Otherwise an empty list looks "finished" and would win "I'm tired, boss",
    // which ranks on being nearly done.
    const list = await createList(harness.db, userId, { title: 'Empty', mediaType: 'movie' })

    expect((await findListWithStats(harness.db, userId, list.id))?.stats).toMatchObject({
      totalItems: 0,
      consumedItems: 0,
      completionPercent: 0,
      timeRemainingMinutes: 0,
      lastConsumedAt: null,
    })
  })

  it('reports a fully finished list as 100% with nothing remaining', async () => {
    const list = await listWith([30, 45], [0, 1])

    expect((await findListWithStats(harness.db, userId, list.id))?.stats).toMatchObject({
      completionPercent: 100,
      timeRemainingMinutes: 0,
    })
  })

  it('rounds an inexact percentage to one decimal place', async () => {
    // 1 of 3 is 33.333…
    const list = await listWith([10, 10, 10], [0])

    expect((await findListWithStats(harness.db, userId, list.id))?.stats.completionPercent).toBe(
      33.3,
    )
  })

  it('reports the most recent consumption as lastConsumedAt', async () => {
    const list = await createList(harness.db, userId, { title: 'PPVs', mediaType: 'tv' })
    const older = (await createListItem(harness.db, userId, list.id, {
      title: 'Older',
      timeToConsumeMinutes: 120,
    }))!
    const newer = (await createListItem(harness.db, userId, list.id, {
      title: 'Newer',
      timeToConsumeMinutes: 120,
    }))!

    await setListItemConsumed(harness.db, userId, list.id, older.id, true, new Date('2026-01-01T00:00:00Z'))
    await setListItemConsumed(harness.db, userId, list.id, newer.id, true, new Date('2026-06-15T00:00:00Z'))

    expect((await findListWithStats(harness.db, userId, list.id))?.stats.lastConsumedAt).toEqual(
      new Date('2026-06-15T00:00:00Z'),
    )
  })

  it('leaves lastConsumedAt null when a list has items but none consumed', async () => {
    const list = await listWith([100, 100])

    expect((await findListWithStats(harness.db, userId, list.id))?.stats.lastConsumedAt).toBeNull()
  })

  it('unchecking an item restores its time to the remaining total', async () => {
    const list = await createList(harness.db, userId, { title: 'Games', mediaType: 'game' })
    const item = (await createListItem(harness.db, userId, list.id, {
      title: 'AC1',
      timeToConsumeMinutes: 900,
    }))!

    await setListItemConsumed(harness.db, userId, list.id, item.id, true)
    expect((await findListWithStats(harness.db, userId, list.id))?.stats.timeRemainingMinutes).toBe(
      0,
    )

    await setListItemConsumed(harness.db, userId, list.id, item.id, false)
    expect((await findListWithStats(harness.db, userId, list.id))?.stats.timeRemainingMinutes).toBe(
      900,
    )
  })

  it('computes stats per list in one pass over many lists', async () => {
    const halfDone = await listWith([60, 60], [0])
    const untouched = await listWith([10, 20, 30])

    const byId = new Map(
      (await findListsWithStats(harness.db, userId)).map((list) => [list.id, list.stats]),
    )

    // Keyed by id rather than position: these two are created in the same
    // millisecond, so `created_at` ties and the id tiebreaker orders them by
    // UUID — stable, but not insertion order. Asserting position here made the
    // test flaky roughly one run in six.
    expect(byId.get(halfDone.id)).toMatchObject({
      totalItems: 2,
      consumedItems: 1,
      completionPercent: 50,
      timeRemainingMinutes: 60,
    })
    expect(byId.get(untouched.id)).toMatchObject({
      totalItems: 3,
      consumedItems: 0,
      completionPercent: 0,
      timeRemainingMinutes: 60,
    })
  })

  it('serves stats over HTTP on both the index and a single list', async () => {
    const list = await listWith([100, 90, 60, 150], [0, 2])

    const index = await harness.app.inject({ method: 'GET', url: '/api/lists' })
    expect(index.json()[0].stats).toMatchObject({
      totalItems: 4,
      consumedItems: 2,
      completionPercent: 50,
      timeRemainingMinutes: 240,
    })

    const single = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(single.json().stats).toMatchObject({ completionPercent: 50, timeRemainingMinutes: 240 })
    expect(single.json().items).toHaveLength(4)
  })

  it('gives a newly created list zeroed stats rather than omitting them', async () => {
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Fresh', mediaType: 'movie' },
    })

    expect(created.json().stats).toMatchObject({
      totalItems: 0,
      completionPercent: 0,
      timeRemainingMinutes: 0,
      lastConsumedAt: null,
    })
  })
})
