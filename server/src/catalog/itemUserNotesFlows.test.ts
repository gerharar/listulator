import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaTypeRegistry, type ListExpansion, type SearchAdapter } from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'

/**
 * H-003 (owner, 2026-10-15): what happens to an item's own note when the list is reset, re-ordered, updated or exported.
 * Reset clears it (and says so first); Undo of a Reset brings it back; Restore Source Order, Sort By Release Date and
 * Update List keep it; deleting an item deletes its note.
 */
interface Item {
  id: string
  title: string
  orderIndex: number
  externalRef: string | null
  notes: string | null
  userNote: string | null
}
interface Detail {
  id: string
  items: Item[]
}

describe('an item’s own note through Reset, Sort, Restore Source Order and Update List', () => {
  let harness: TestApp

  const upstream = [
    { title: 'Late One', year: 2010, group: 'Arc B', externalRef: 'g:1', notes: 'Curator: read this first' },
    { title: 'Early One', year: 1999, group: 'Arc A', externalRef: 'g:2' },
    { title: 'Late Two', year: 2012, group: 'Arc B', externalRef: 'g:3' },
    { title: 'Early Two', year: 2001, group: 'Arc A', externalRef: 'g:4' },
  ]
  const expand = vi.fn(async (): Promise<ListExpansion> => ({ items: upstream, status: 'ongoing' }))
  const adapter: SearchAdapter = { isAvailable: () => true, search: async () => [], expand }

  beforeEach(() => {
    expand.mockReset()
    expand.mockImplementation(async () => ({ items: upstream, status: 'ongoing' }))
    harness = createTestApp({
      mediaTypes: createMediaTypeRegistry([{ key: 'game', label: 'Games', sortOrder: 10, defaultDurationMinutes: 600, adapter }]),
    })
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as object } : {}) })
  const detail = async (id: string): Promise<Detail> => (await send('GET', `/lists/${id}`)).json()
  const byTitle = (d: Detail, title: string) => d.items.find((item) => item.title === title)!
  const noteOf = async (listId: string, title: string) => byTitle(await detail(listId), title).userNote

  /** A list from a source with notes on two of its items. */
  async function notedList(): Promise<Detail> {
    const created = await send('POST', '/lists/from-source', { mediaType: 'game', externalRef: 'franchise:1', title: 'A franchise' })
    const list = await detail(created.json().id)
    await send('PATCH', `/lists/${list.id}/items/${byTitle(list, 'Early One').id}`, { userNote: 'Mira says it’s good' })
    await send('PATCH', `/lists/${list.id}/items/${byTitle(list, 'Late Two').id}`, { userNote: 'Skip the intro' })

    return detail(list.id)
  }

  describe('Reset', () => {
    it('says how many notes it will clear, counting only the notes on items that stay: a hand-added item goes with its note', async () => {
      const list = await notedList()
      await send('POST', `/lists/${list.id}/items`, { title: 'Mine', timeToConsumeMinutes: 10, userNote: 'Goes with the item' })

      const preview = (await send('GET', `/lists/${list.id}/reset-preview`)).json()

      expect(preview).toMatchObject({ removed: 1, notesCleared: 2 })
    })

    it('counts no note when there is none', async () => {
      const created = await send('POST', '/lists/from-source', { mediaType: 'game', externalRef: 'franchise:1', title: 'A franchise' })

      expect((await send('GET', `/lists/${created.json().id}/reset-preview`)).json()).toMatchObject({ notesCleared: 0 })
    })

    it('does not count the note of an item that was deleted: it went with the item, and the item comes back without it', async () => {
      const list = await notedList()
      await send('DELETE', `/lists/${list.id}/items/${byTitle(list, 'Early One').id}`)

      const preview = (await send('GET', `/lists/${list.id}/reset-preview`)).json()

      expect(preview).toMatchObject({ restored: 1, notesCleared: 1 })
    })

    it('clears the notes, says how many in what it did, and leaves the curator’s notes as the source has them', async () => {
      const list = await notedList()

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(200)
      expect(reset.json().counts).toMatchObject({ notesCleared: 2 })
      const after = await detail(list.id)
      expect(after.items.map((item) => item.userNote)).toEqual([null, null, null, null])
      expect(byTitle(after, 'Late One').notes).toBe('Curator: read this first')
    })

    it('is undone with the notes back on their items', async () => {
      const list = await notedList()
      const reset = await send('POST', `/lists/${list.id}/reset`)
      expect(await noteOf(list.id, 'Early One')).toBeNull()

      const undone = await send('PUT', `/lists/${list.id}/items/restore-all`, reset.json().restore)

      expect(undone.statusCode).toBe(200)
      expect(await noteOf(list.id, 'Early One')).toBe('Mira says it’s good')
      expect(await noteOf(list.id, 'Late Two')).toBe('Skip the intro')
    })
  })

  describe('what keeps a note', () => {
    it('Sort By Release Date', async () => {
      const list = await notedList()

      await send('POST', `/lists/${list.id}/sort`)

      expect(await noteOf(list.id, 'Early One')).toBe('Mira says it’s good')
      expect(await noteOf(list.id, 'Late Two')).toBe('Skip the intro')
    })

    it('Restore Source Order', async () => {
      const list = await notedList()
      await send('POST', `/lists/${list.id}/sort`)

      await send('POST', `/lists/${list.id}/reset-order`)

      expect(await noteOf(list.id, 'Early One')).toBe('Mira says it’s good')
      expect(await noteOf(list.id, 'Late Two')).toBe('Skip the intro')
    })

    it('a hand reorder', async () => {
      const list = await notedList()

      await send('PUT', `/lists/${list.id}/items/order`, { itemIds: [...list.items].reverse().map((item) => item.id) })

      expect(await noteOf(list.id, 'Early One')).toBe('Mira says it’s good')
      expect(await noteOf(list.id, 'Late Two')).toBe('Skip the intro')
    })

    it('Update List: what the source adds comes in, and what is there keeps its note', async () => {
      const list = await notedList()

      const added = await send('POST', `/lists/${list.id}/items/import`, {
        source: 'import',
        items: [{ title: 'Newcomer', externalRef: 'g:9', timeToConsumeMinutes: 30 }],
      })

      expect(added.statusCode).toBe(201)
      const after = await detail(list.id)
      expect(after.items).toHaveLength(5)
      expect(byTitle(after, 'Early One').userNote).toBe('Mira says it’s good')
      expect(byTitle(after, 'Newcomer').userNote).toBeNull()
    })
  })

  describe('deleting an item', () => {
    it('deletes its note with it, and Undo brings the note back', async () => {
      const list = await notedList()
      const item = byTitle(list, 'Late Two')

      const deleted = await send('DELETE', `/lists/${list.id}/items/${item.id}`)
      expect((await detail(list.id)).items.some((entry) => entry.id === item.id)).toBe(false)
      await send('POST', `/lists/${list.id}/items/restore`, deleted.json().restore)

      expect(await noteOf(list.id, 'Late Two')).toBe('Skip the intro')
    })
  })
})
