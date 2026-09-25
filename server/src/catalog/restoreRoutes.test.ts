import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dismissedItems } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'

/** The Undo endpoints (D2, task 10.19a), over HTTP. */
describe('undo routes', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as object } : {}) })

  async function makeList(title = 'Show') {
    return (await send('POST', '/lists', { title, mediaType: 'tv' })).json()
  }

  const addItem = async (listId: string, title: string, extra: object = {}) =>
    (await send('POST', `/lists/${listId}/items`, { title, timeToConsumeMinutes: 30, ...extra })).json()

  const detail = async (listId: string) => (await send('GET', `/lists/${listId}`)).json()

  describe('an item', () => {
    it('is returned by the delete, and comes back with its position and done state', async () => {
      const list = await makeList()
      await addItem(list.id, 'First')
      const middle = await addItem(list.id, 'Middle')
      await addItem(list.id, 'Last')
      await send('PUT', `/lists/${list.id}/items/${middle.id}/consumed`, { consumed: true })

      const deleted = await send('DELETE', `/lists/${list.id}/items/${middle.id}`)

      expect(deleted.statusCode).toBe(200)
      expect(deleted.json().restore.item).toMatchObject({ id: middle.id, title: 'Middle', orderIndex: middle.orderIndex })
      expect((await detail(list.id)).items.map((i: { title: string }) => i.title)).toEqual(['First', 'Last'])
      // The delete recorded a dismissal, so a refresh would not offer it back...
      expect(harness.db.select().from(dismissedItems).all()).toHaveLength(1)

      const restored = await send('POST', `/lists/${list.id}/items/restore`, deleted.json().restore)

      // ...and Undo removes it again.
      expect(harness.db.select().from(dismissedItems).all()).toEqual([])

      expect(restored.statusCode).toBe(200)
      expect(restored.json()).toMatchObject({ id: middle.id, orderIndex: middle.orderIndex })
      const after = await detail(list.id)
      expect(after.items.map((i: { title: string }) => i.title)).toEqual(['First', 'Middle', 'Last'])
      expect(after.items[1].consumedAt).toEqual(expect.any(String))
    })

    it('404s for an unknown item, and for a list that does not exist', async () => {
      const list = await makeList()

      expect((await send('DELETE', `/lists/${list.id}/items/nope`)).statusCode).toBe(404)
      expect(
        (await send('POST', '/lists/nope/items/restore', { item: itemPayload(), dismissalId: null })).statusCode,
      ).toBe(404)
    })

    it('ignores a list id smuggled into the body: the list comes from the path', async () => {
      const list = await makeList()
      const other = await makeList('Other')

      const response = await send('POST', `/lists/${list.id}/items/restore`, {
        item: itemPayload(),
        dismissalId: null,
        listId: other.id,
      })

      expect(response.statusCode).toBe(200)
      expect((await detail(list.id)).items).toHaveLength(1)
      expect((await detail(other.id)).items).toHaveLength(0)
    })

    it('refuses a malformed restore body', async () => {
      const list = await makeList()

      expect((await send('POST', `/lists/${list.id}/items/restore`, { item: { title: 'x' } })).statusCode).toBe(400)
    })
  })

  describe('a group', () => {
    it('is returned by the delete, and comes back at its position', async () => {
      const list = await makeList()
      await send('POST', `/lists/${list.id}/groups`, { name: 'A' })
      const b = (await send('POST', `/lists/${list.id}/groups`, { name: 'B' })).json()
      await send('POST', `/lists/${list.id}/groups`, { name: 'C' })

      const deleted = await send('DELETE', `/lists/${list.id}/groups/${b.id}`)
      expect(deleted.statusCode).toBe(200)
      expect(deleted.json().restore.group).toMatchObject({ id: b.id, name: 'B', orderIndex: 1 })

      const restored = await send('POST', `/lists/${list.id}/groups/restore`, deleted.json().restore)

      expect(restored.statusCode).toBe(200)
      expect((await detail(list.id)).groups.map((g: { name: string }) => g.name)).toEqual(['A', 'B', 'C'])
    })

    it('will not come back under a name that is taken, saying so with a code', async () => {
      const list = await makeList()
      const group = (await send('POST', `/lists/${list.id}/groups`, { name: 'Taken' })).json()
      const deleted = await send('DELETE', `/lists/${list.id}/groups/${group.id}`)
      await send('POST', `/lists/${list.id}/groups`, { name: 'Taken' })

      const restored = await send('POST', `/lists/${list.id}/groups/restore`, deleted.json().restore)

      expect(restored.statusCode).toBe(409)
      expect(restored.json().code).toBe('group.nameTaken')
    })
  })

  describe('a whole list', () => {
    it('is returned by the delete, and comes back with items, groups and progress', async () => {
      const list = await makeList('Keep me')
      const a = await addItem(list.id, 'A', { group: 'S1' })
      await addItem(list.id, 'B', { group: 'S1' })
      await send('PUT', `/lists/${list.id}/items/${a.id}/consumed`, { consumed: true })
      await send('POST', `/lists/${list.id}/groups`, { name: 'Empty' })
      const before = await detail(list.id)

      const deleted = await send('DELETE', `/lists/${list.id}`)

      expect(deleted.statusCode).toBe(200)
      expect((await send('GET', `/lists/${list.id}`)).statusCode).toBe(404)

      const restored = await send('POST', '/lists/restore', deleted.json().restore)

      expect(restored.statusCode).toBe(201)
      const after = await detail(list.id)
      expect(after.title).toBe('Keep me')
      expect(after.stats).toEqual(before.stats)
      expect(after.items.map((i: { id: string; consumedAt: string | null }) => [i.id, i.consumedAt])).toEqual(
        before.items.map((i: { id: string; consumedAt: string | null }) => [i.id, i.consumedAt]),
      )
      expect(after.groups.map((g: { name: string }) => g.name)).toEqual(['S1', 'Empty'])
    })

    it('refuses to overwrite a list that exists, with a code', async () => {
      const list = await makeList()
      const deleted = await send('DELETE', `/lists/${list.id}`)
      await send('POST', '/lists/restore', deleted.json().restore)

      const again = await send('POST', '/lists/restore', deleted.json().restore)

      expect(again.statusCode).toBe(409)
      expect(again.json().code).toBe('list.alreadyExists')
    })

    it('restores a long list, past the default request size', async () => {
      const list = await makeList('Long')
      await send('POST', `/lists/${list.id}/items/import`, {
        items: Array.from({ length: 6000 }, (_, index) => ({ title: `Item ${index}` })),
      })
      const deleted = await send('DELETE', `/lists/${list.id}`)

      const restored = await send('POST', '/lists/restore', deleted.json().restore)

      expect(restored.statusCode).toBe(201)
      expect((await detail(list.id)).items).toHaveLength(6000)
    }, 60_000)

    it('404s for a list that does not exist', async () => {
      expect((await send('DELETE', '/lists/nope')).statusCode).toBe(404)
    })
  })

  describe('a whole item set (Reset’s undo)', () => {
    it('replaces the list’s items with the captured ones, exactly', async () => {
      const list = await makeList()
      const a = await addItem(list.id, 'A')
      const captured = (await send('DELETE', `/lists/${list.id}/items/${a.id}`)).json().restore
      await addItem(list.id, 'Different')

      const response = await send('PUT', `/lists/${list.id}/items/restore-all`, {
        items: [captured.item],
        dismissals: [],
      })

      expect(response.statusCode).toBe(200)
      expect((await detail(list.id)).items.map((i: { title: string }) => i.title)).toEqual(['A'])
    })

    it('404s for a list that does not exist', async () => {
      expect(
        (await send('PUT', '/lists/nope/items/restore-all', { items: [], dismissals: [] })).statusCode,
      ).toBe(404)
    })
  })
})

function itemPayload() {
  const now = new Date().toISOString()

  return {
    id: 'x',
    title: 'x',
    orderIndex: 0,
    timeToConsumeMinutes: 1,
    timeToConsumeIsEstimated: true,
    externalRef: null,
    source: 'manual',
    year: null,
    group: null,
    tags: null,
    consumedAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  }
}
