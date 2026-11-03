import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems } from './bulkItems.js'
import { InvalidConsumedRestoreError, restoreConsumed, setItemsConsumed } from './consumed.js'
import { createList, createListItem, findListItems, setListItemConsumed } from './repository.js'

/**
 * Mark a whole group done or not done (H-026, task 46.1): one call that changes only the items that
 * differ and hands back what each was, and the mirror call that puts that back.
 */
describe('marking many items done or not done', () => {
  let harness: TestApp
  let ownerId: string
  let strangerId: string
  let listId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()

    ownerId = harness.db.select().from(users).get()!.id
    strangerId = harness.db.insert(users).values({}).returning().get().id
    listId = (await createList(harness.db, ownerId, { title: 'Show', mediaType: 'tv' })).id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  async function addItem(title: string, group: string | null = null) {
    return (await createListItem(harness.db, ownerId, listId, { title, timeToConsumeMinutes: 30, group }))!
  }

  const rows = async () => (await findListItems(harness.db, ownerId, listId))!
  const row = async (id: string) => (await rows()).find((entry) => entry.id === id)!
  const longAgo = new Date('2025-03-04T05:06:07.089Z')

  describe('setItemsConsumed', () => {
    it('marks every given item done with one shared time and hands each one back as it was', async () => {
      const [a, b, c] = [await addItem('A'), await addItem('B'), await addItem('C')]
      const now = new Date('2026-11-04T10:00:00.000Z')

      const restore = await setItemsConsumed(harness.db, ownerId, listId, [a.id, b.id], true, now)

      expect(restore!.items).toHaveLength(2)
      expect(restore!.items).toEqual(
        expect.arrayContaining([
          { id: a.id, consumedAt: null },
          { id: b.id, consumedAt: null },
        ]),
      )
      expect((await row(a.id)).consumedAt).toEqual(now)
      expect((await row(b.id)).consumedAt).toEqual(now)
      expect((await row(c.id)).consumedAt).toBeNull()
    })

    it('leaves an item that is already done alone: its date and updated time stay, and it is not in the result', async () => {
      const done = await addItem('Done')
      const open = await addItem('Open')
      await setListItemConsumed(harness.db, ownerId, listId, done.id, true, longAgo)
      const before = await row(done.id)

      const restore = await setItemsConsumed(harness.db, ownerId, listId, [done.id, open.id], true, new Date('2026-11-04T10:00:00.000Z'))

      expect(restore!.items.map((entry) => entry.id)).toEqual([open.id])
      const after = await row(done.id)
      expect(after.consumedAt).toEqual(longAgo)
      expect(after.updatedAt).toEqual(before.updatedAt)
    })

    it('marks items not done and hands back the dates they had', async () => {
      const [a, b, c] = [await addItem('A'), await addItem('B'), await addItem('C')]
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true, longAgo)
      await setListItemConsumed(harness.db, ownerId, listId, b.id, true, new Date('2026-01-02T03:04:05.006Z'))

      const restore = await setItemsConsumed(harness.db, ownerId, listId, [a.id, b.id, c.id], false)

      expect(restore!.items).toHaveLength(2)
      expect(restore!.items).toEqual(
        expect.arrayContaining([
          { id: a.id, consumedAt: longAgo.toISOString() },
          { id: b.id, consumedAt: '2026-01-02T03:04:05.006Z' },
        ]),
      )
      expect((await rows()).every((entry) => entry.consumedAt === null)).toBe(true)
    })

    it('touches only the given items', async () => {
      const [a, b] = [await addItem('A'), await addItem('B')]

      await setItemsConsumed(harness.db, ownerId, listId, [a.id], true)

      expect((await row(a.id)).consumedAt).not.toBeNull()
      expect((await row(b.id)).consumedAt).toBeNull()
    })

    it('ignores ids that are not in this list: another list\'s items and ids that do not exist', async () => {
      const mine = await addItem('Mine')
      const other = (await createList(harness.db, ownerId, { title: 'Other', mediaType: 'tv' })).id
      const theirs = (await createListItem(harness.db, ownerId, other, { title: 'Theirs', timeToConsumeMinutes: 30 }))!

      const restore = await setItemsConsumed(harness.db, ownerId, listId, [mine.id, theirs.id, 'nope'], true)

      expect(restore!.items.map((entry) => entry.id)).toEqual([mine.id])
      const untouched = (await findListItems(harness.db, ownerId, other))!
      expect(untouched[0]!.consumedAt).toBeNull()
    })

    it('counts a repeated id once', async () => {
      const a = await addItem('A')

      const restore = await setItemsConsumed(harness.db, ownerId, listId, [a.id, a.id], true)

      expect(restore!.items).toHaveLength(1)
    })

    it('with no ids changes nothing and says so', async () => {
      await addItem('A')

      expect(await setItemsConsumed(harness.db, ownerId, listId, [], true)).toEqual({ items: [] })
    })

    it('is undefined for a list that is not the user\'s, and writes nothing', async () => {
      const a = await addItem('A')

      expect(await setItemsConsumed(harness.db, strangerId, listId, [a.id], true)).toBeUndefined()
      expect((await row(a.id)).consumedAt).toBeNull()
    })

    it('marks a group of 50,000 items in one call (batches stay under the SQL variable limit)', async () => {
      const made = await createListItems(
        harness.db,
        ownerId,
        listId,
        Array.from({ length: 50_000 }, (_, index) => ({ title: `Episode ${index}`, timeToConsumeMinutes: 30, group: 'Big' })),
      )
      const ids = made!.map((entry) => entry.id)

      const restore = await setItemsConsumed(harness.db, ownerId, listId, ids, true)

      expect(restore!.items).toHaveLength(50_000)
      expect((await rows()).filter((entry) => entry.consumedAt !== null)).toHaveLength(50_000)

      const back = await setItemsConsumed(harness.db, ownerId, listId, ids, false)
      expect(back!.items).toHaveLength(50_000)
      expect((await rows()).filter((entry) => entry.consumedAt !== null)).toHaveLength(0)
    }, 120_000)
  })

  describe('restoreConsumed', () => {
    it('puts each item back as it was, done dates included', async () => {
      const [a, b, c] = [await addItem('A'), await addItem('B'), await addItem('C')]
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true, longAgo)
      await setListItemConsumed(harness.db, ownerId, listId, b.id, true, new Date('2026-01-02T03:04:05.006Z'))
      const marked = await setItemsConsumed(harness.db, ownerId, listId, [a.id, b.id, c.id], false)

      expect(await restoreConsumed(harness.db, ownerId, listId, marked!)).toBe(true)

      expect((await row(a.id)).consumedAt).toEqual(longAgo)
      expect((await row(b.id)).consumedAt).toEqual(new Date('2026-01-02T03:04:05.006Z'))
      expect((await row(c.id)).consumedAt).toBeNull()
    })

    it('undoes a mark done: the items are open again', async () => {
      const [a, b] = [await addItem('A'), await addItem('B')]
      const marked = await setItemsConsumed(harness.db, ownerId, listId, [a.id, b.id], true)

      await restoreConsumed(harness.db, ownerId, listId, marked!)

      expect((await rows()).every((entry) => entry.consumedAt === null)).toBe(true)
    })

    it('is harmless when run twice', async () => {
      const a = await addItem('A')
      const marked = await setItemsConsumed(harness.db, ownerId, listId, [a.id], true)

      await restoreConsumed(harness.db, ownerId, listId, marked!)
      await restoreConsumed(harness.db, ownerId, listId, marked!)

      expect((await row(a.id)).consumedAt).toBeNull()
    })

    it('puts an item back even when it was ticked again since', async () => {
      const a = await addItem('A')
      const marked = await setItemsConsumed(harness.db, ownerId, listId, [a.id], true)
      await setListItemConsumed(harness.db, ownerId, listId, a.id, false)
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true)

      await restoreConsumed(harness.db, ownerId, listId, marked!)

      expect((await row(a.id)).consumedAt).toBeNull()
    })

    it('never touches an item of another list', async () => {
      const other = (await createList(harness.db, ownerId, { title: 'Other', mediaType: 'tv' })).id
      const theirs = (await createListItem(harness.db, ownerId, other, { title: 'Theirs', timeToConsumeMinutes: 30 }))!
      await setListItemConsumed(harness.db, ownerId, other, theirs.id, true, longAgo)

      await restoreConsumed(harness.db, ownerId, listId, { items: [{ id: theirs.id, consumedAt: null }] })

      expect((await findListItems(harness.db, ownerId, other))![0]!.consumedAt).toEqual(longAgo)
    })

    it('refuses a date that is not a date, whole, and writes nothing (it would have cleared the item\'s done date)', async () => {
      const [a, b] = [await addItem('A'), await addItem('B')]
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true, longAgo)
      await setListItemConsumed(harness.db, ownerId, listId, b.id, true, longAgo)

      await expect(
        restoreConsumed(harness.db, ownerId, listId, { items: [{ id: a.id, consumedAt: null }, { id: b.id, consumedAt: 'garbage' }] }),
      ).rejects.toBeInstanceOf(InvalidConsumedRestoreError)

      // Not even the valid entry before it was applied.
      expect((await row(a.id)).consumedAt).toEqual(longAgo)
      expect((await row(b.id)).consumedAt).toEqual(longAgo)
    })

    it('is false for a list that is not the user\'s, and writes nothing', async () => {
      const a = await addItem('A')
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true, longAgo)

      expect(await restoreConsumed(harness.db, strangerId, listId, { items: [{ id: a.id, consumedAt: null }] })).toBe(false)
      expect((await row(a.id)).consumedAt).toEqual(longAgo)
    })
  })

  describe('over HTTP', () => {
    const send = (method: 'PUT', url: string, payload: unknown) =>
      harness.app.inject({ method, url: `/api${url}`, payload: payload as object })

    it('PUT /lists/:id/consumed marks the items and returns the Undo payload; /consumed/restore puts them back', async () => {
      const [a, b] = [await addItem('A'), await addItem('B')]
      await setListItemConsumed(harness.db, ownerId, listId, b.id, true, longAgo)

      const marked = await send('PUT', `/lists/${listId}/consumed`, { itemIds: [a.id, b.id], consumed: true })

      expect(marked.statusCode).toBe(200)
      expect(marked.json()).toEqual({ restore: { items: [{ id: a.id, consumedAt: null }] } })
      expect((await row(a.id)).consumedAt).not.toBeNull()

      const undone = await send('PUT', `/lists/${listId}/consumed/restore`, marked.json().restore)

      expect(undone.statusCode).toBe(200)
      expect((await row(a.id)).consumedAt).toBeNull()
      expect((await row(b.id)).consumedAt).toEqual(longAgo)
    })

    it('is a 404 for a list that does not exist, for both calls', async () => {
      const marked = await send('PUT', '/lists/nope/consumed', { itemIds: [], consumed: true })
      const undone = await send('PUT', '/lists/nope/consumed/restore', { items: [] })

      expect(marked.statusCode).toBe(404)
      expect(undone.statusCode).toBe(404)
    })

    it.each([
      ['no consumed flag', { itemIds: [] }],
      ['no ids', { consumed: true }],
      ['ids that are not strings', { itemIds: [{}], consumed: true }],
      ['a flag that is not a boolean', { itemIds: [], consumed: 'yes' }],
      ['an empty id', { itemIds: [''], consumed: true }],
    ])('refuses a body with %s', async (_label, body) => {
      expect((await send('PUT', `/lists/${listId}/consumed`, body)).statusCode).toBe(400)
    })

    it.each([
      ['no items', {}],
      ['an entry with no id', { items: [{ consumedAt: null }] }],
      ['a date that is not text', { items: [{ id: 'x', consumedAt: {} }] }],
    ])('refuses an Undo body with %s', async (_label, body) => {
      expect((await send('PUT', `/lists/${listId}/consumed/restore`, body)).statusCode).toBe(400)
    })

    it('answers 400 to an Undo with a date that is not a date, and the item keeps its done date', async () => {
      const a = await addItem('A')
      await setListItemConsumed(harness.db, ownerId, listId, a.id, true, longAgo)

      const undone = await send('PUT', `/lists/${listId}/consumed/restore`, { items: [{ id: a.id, consumedAt: 'garbage' }] })

      expect(undone.statusCode).toBe(400)
      expect((await row(a.id)).consumedAt).toEqual(longAgo)
    })

    const ids = (count: number) => Array.from({ length: count }, (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`)

    it('takes 100,000 ids and refuses 100,001, as the order route does', async () => {
      expect((await send('PUT', `/lists/${listId}/consumed`, { itemIds: ids(100_000), consumed: true })).statusCode).toBe(200)
      expect((await send('PUT', `/lists/${listId}/consumed`, { itemIds: ids(100_001), consumed: true })).statusCode).toBe(400)
    }, 60_000)

    it('refuses an Undo of more than 100,000 items', async () => {
      const items = ids(100_001).map((id) => ({ id, consumedAt: null }))

      expect((await send('PUT', `/lists/${listId}/consumed/restore`, { items })).statusCode).toBe(400)
    }, 60_000)

    it('refuses a body of ids past 8 MB before it is read (the ids are about 40 bytes each, not whole items)', async () => {
      const marked = await send('PUT', `/lists/${listId}/consumed`, { itemIds: ids(250_000), consumed: true })

      expect(marked.statusCode).toBe(413)
    }, 60_000)

    it('takes the ids of a 50,000-item group in one request body', async () => {
      const ids = Array.from({ length: 50_000 }, (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`)

      const marked = await send('PUT', `/lists/${listId}/consumed`, { itemIds: ids, consumed: true })

      expect(marked.statusCode).toBe(200)
      expect(marked.json()).toEqual({ restore: { items: [] } })
    })
  })
})
