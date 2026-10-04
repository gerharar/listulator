import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listGroups, listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems } from './bulkItems.js'
import { createListGroup } from './groups.js'
import { setGroupPositions, setItemPositions } from './orderIndex.js'
import { createList } from './repository.js'

describe('setting many positions at once', () => {
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

  async function listWith(count: number) {
    const list = await createList(harness.db, userId, { title: 'L', mediaType: 'movie' })
    await createListItems(
      harness.db,
      userId,
      list.id,
      Array.from({ length: count }, (_, index) => ({
        title: `T${index}`,
        timeToConsumeMinutes: 90,
        timeToConsumeIsEstimated: false,
        source: 'import' as const,
      })),
    )
    return list.id
  }

  const itemsOf = (listId: string) =>
    harness.db.select().from(listItems).where(eq(listItems.listId, listId)).orderBy(asc(listItems.orderIndex)).all()

  it('moves every item to its new position, across more rows than one statement takes', async () => {
    const listId = await listWith(1203)
    const reversed = itemsOf(listId).map((item, index, all) => ({ id: item.id, orderIndex: all.length - 1 - index }))

    await setItemPositions(harness.db, listId, reversed)

    const after = itemsOf(listId)
    expect(after.map((item) => item.title)).toEqual(Array.from({ length: 1203 }, (_, index) => `T${1202 - index}`))
    expect(after.map((item) => item.orderIndex)).toEqual(Array.from({ length: 1203 }, (_, index) => index))
  })

  it('leaves alone the rows it was not given, and every row of another list, even one named by id', async () => {
    const listId = await listWith(3)
    const otherId = await listWith(2)
    const [first, second, third] = itemsOf(listId)
    const foreign = itemsOf(otherId)[0]!

    await setItemPositions(harness.db, listId, [
      { id: first!.id, orderIndex: 7 },
      { id: foreign.id, orderIndex: 9 },
    ])

    expect(itemsOf(listId).map((item) => [item.title, item.orderIndex])).toEqual([
      [second!.title, second!.orderIndex],
      [third!.title, third!.orderIndex],
      [first!.title, 7],
    ])
    expect(itemsOf(otherId)[0]).toMatchObject({ id: foreign.id, orderIndex: foreign.orderIndex })
  })

  it('stamps updated_at only when asked', async () => {
    const listId = await listWith(2)
    const [a, b] = itemsOf(listId)
    const stamp = new Date('2030-01-01T00:00:00Z')

    await setItemPositions(harness.db, listId, [{ id: a!.id, orderIndex: 1 }], { touch: stamp })
    await setItemPositions(harness.db, listId, [{ id: b!.id, orderIndex: 0 }])

    const after = new Map(itemsOf(listId).map((item) => [item.id, item.updatedAt.getTime()]))
    expect(after.get(a!.id)).toBe(stamp.getTime())
    expect(after.get(b!.id)).toBe(b!.updatedAt.getTime())
  })

  it('does nothing for no positions', async () => {
    const listId = await listWith(1)

    await setItemPositions(harness.db, listId, [])
    await setGroupPositions(harness.db, listId, [])

    expect(itemsOf(listId)).toHaveLength(1)
  })

  it('moves groups the same way', async () => {
    const listId = await listWith(0)
    const a = (await createListGroup(harness.db, userId, listId, 'A'))!
    const b = (await createListGroup(harness.db, userId, listId, 'B'))!

    await setGroupPositions(harness.db, listId, [
      { id: a.id, orderIndex: 1 },
      { id: b.id, orderIndex: 0 },
    ])

    const names = harness.db
      .select()
      .from(listGroups)
      .where(eq(listGroups.listId, listId))
      .orderBy(asc(listGroups.orderIndex))
      .all()
      .map((group) => group.name)
    expect(names).toEqual(['B', 'A'])
  })
})
