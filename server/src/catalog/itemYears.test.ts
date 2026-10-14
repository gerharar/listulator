import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems } from './bulkItems.js'
import { createList, createListItem, findListItems, updateListItem } from './repository.js'
import { InvalidYearError } from './years.js'

/**
 * H-004 / H-005: an item's year may have unknown last digits (`199?`, `19??`), stored as `year` (the earliest it can be)
 * plus `yearUnk` (how many digits are unknown). The pair is checked in the repository, the one place the server and the
 * desktop both go through, so an API or a file can never leave a row saying `1994` and `19?4`.
 */
describe('an item’s year and its unknown digits', () => {
  let harness: TestApp
  let owner: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    owner = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db
  const newList = () => createList(db(), owner, { title: 'Music', mediaType: 'music' })
  const row = (itemId: string) => db().select().from(listItems).where(eq(listItems.id, itemId)).get()!

  describe('in the repository', () => {
    it('keeps an exact year as it always was, with no unknown digits', async () => {
      const list = await newList()
      const item = await createListItem(db(), owner, list.id, { title: 'Album', timeToConsumeMinutes: 40, year: 1994 })

      expect(row(item!.id)).toMatchObject({ year: 1994, yearUnk: 0 })
    })

    it('stores a partial year as the earliest it can be and how many digits are unknown', async () => {
      const list = await newList()
      const decade = await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40, year: 1980, yearUnk: 1 })
      const century = await createListItem(db(), owner, list.id, { title: 'Demo', timeToConsumeMinutes: 40, year: 1900, yearUnk: 2 })

      expect(row(decade!.id)).toMatchObject({ year: 1980, yearUnk: 1 })
      expect(row(century!.id)).toMatchObject({ year: 1900, yearUnk: 2 })
    })

    it('has no year and no unknown digits by default', async () => {
      const list = await newList()
      const item = await createListItem(db(), owner, list.id, { title: 'Album', timeToConsumeMinutes: 40 })

      expect(row(item!.id)).toMatchObject({ year: null, yearUnk: 0 })
    })

    it.each([
      [1994, 1],
      [1990, 2],
      [1990, 3],
      [3500, 0],
      [0, 0],
      [null, 1],
    ])('refuses to make an item with year %j and %j unknown digits', async (year, yearUnk) => {
      const list = await newList()

      await expect(createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 1, year, yearUnk } as never)).rejects.toThrow(InvalidYearError)
      expect(await findListItems(db(), owner, list.id)).toEqual([])
    })

    describe('when an item is edited', () => {
      const withItem = async (year?: number, yearUnk?: 0 | 1 | 2) => {
        const list = await newList()
        const item = await createListItem(db(), owner, list.id, { title: 'Album', timeToConsumeMinutes: 40, ...(year ? { year } : {}), ...(yearUnk ? { yearUnk } : {}) })

        return { list, item: item! }
      }

      it('sets an exact year, a partial one, and clears it', async () => {
        const { list, item } = await withItem()

        await updateListItem(db(), owner, list.id, item.id, { year: 1994 })
        expect(row(item.id)).toMatchObject({ year: 1994, yearUnk: 0 })

        await updateListItem(db(), owner, list.id, item.id, { year: 1990, yearUnk: 1 })
        expect(row(item.id)).toMatchObject({ year: 1990, yearUnk: 1 })

        await updateListItem(db(), owner, list.id, item.id, { year: null })
        expect(row(item.id)).toMatchObject({ year: null, yearUnk: 0 })
      })

      it('takes a year sent without its unknown digits as an exact year: the digits are cleared, not kept', async () => {
        const { list, item } = await withItem(1990, 1)

        await updateListItem(db(), owner, list.id, item.id, { year: 1994 })

        expect(row(item.id)).toMatchObject({ year: 1994, yearUnk: 0 })
      })

      it('leaves the year alone when the edit is about something else', async () => {
        const { list, item } = await withItem(1990, 1)

        await updateListItem(db(), owner, list.id, item.id, { title: 'Renamed' })

        expect(row(item.id)).toMatchObject({ title: 'Renamed', year: 1990, yearUnk: 1 })
      })

      it.each([
        [{ year: 1994, yearUnk: 1 }],
        [{ year: 1990, yearUnk: 2 }],
        [{ year: 3500 }],
        [{ year: 0 }],
        [{ yearUnk: 1 }],
        [{ year: null, yearUnk: 2 }],
      ])('refuses %j and leaves the item as it was', async (patch) => {
        const { list, item } = await withItem(1990, 1)

        await expect(updateListItem(db(), owner, list.id, item.id, patch as never)).rejects.toThrow(InvalidYearError)
        expect(row(item.id)).toMatchObject({ year: 1990, yearUnk: 1 })
      })
    })

    it('inserts many items with their partial years in one go', async () => {
      const list = await newList()

      await createListItems(db(), owner, list.id, [
        { title: 'A', timeToConsumeMinutes: 1, year: 1980, yearUnk: 1 },
        { title: 'B', timeToConsumeMinutes: 1, year: 1999 },
        { title: 'C', timeToConsumeMinutes: 1 },
      ])

      expect((await findListItems(db(), owner, list.id))!.map((item) => [item.title, item.year, item.yearUnk])).toEqual([
        ['A', 1980, 1],
        ['B', 1999, 0],
        ['C', null, 0],
      ])
    })
  })

  describe('over the API', () => {
    const inject = (method: 'POST' | 'PATCH' | 'GET' | 'DELETE', url: string, payload?: unknown) =>
      harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as never } : {}) })

    it('adds an item with a partial year, and says so when the list is read', async () => {
      const list = await newList()

      const created = await inject('POST', `/lists/${list.id}/items`, { title: 'Tape', timeToConsumeMinutes: 40, year: 1980, yearUnk: 1 })

      expect(created.statusCode).toBe(201)
      expect(created.json()).toMatchObject({ year: 1980, yearUnk: 1 })
      expect((await inject('GET', `/lists/${list.id}`)).json().items[0]).toMatchObject({ year: 1980, yearUnk: 1 })
    })

    it('edits an item’s year and its unknown digits', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40, year: 1994 }))!

      const patched = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { year: 1900, yearUnk: 2 })

      expect(patched.statusCode).toBe(200)
      expect(patched.json()).toMatchObject({ year: 1900, yearUnk: 2 })
    })

    it('clears an item’s year with null', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40, year: 1980, yearUnk: 1 }))!

      const patched = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { year: null })

      expect(patched.json()).toMatchObject({ year: null, yearUnk: 0 })
    })

    it.each([
      [{ year: 1994, yearUnk: 1 }],
      [{ year: 3500 }],
      [{ year: 0 }],
      [{ yearUnk: 1 }],
      [{ year: 1990, yearUnk: 3 }],
    ])('refuses %j with a code the screen can word, and changes nothing', async (patch) => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40, year: 1990, yearUnk: 1 }))!

      const response = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, patch)

      expect(response.statusCode).toBe(400)
      expect(row(item.id)).toMatchObject({ year: 1990, yearUnk: 1 })
    })

    it('says "item.invalidYear" for a year that does not fit, rather than a framework message', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40 }))!

      const response = await inject('PATCH', `/lists/${list.id}/items/${item.id}`, { year: 1994, yearUnk: 1 })

      expect(response.json()).toEqual({ code: 'item.invalidYear' })
    })

    it('puts a deleted item back with its partial year, from a payload that has it', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Tape', timeToConsumeMinutes: 40, year: 1980, yearUnk: 1 }))!

      const deleted = await inject('DELETE', `/lists/${list.id}/items/${item.id}`)
      expect(deleted.json().restore.item).toMatchObject({ year: 1980, yearUnk: 1 })

      const restored = await inject('POST', `/lists/${list.id}/items/restore`, deleted.json().restore)

      expect(restored.statusCode).toBe(200)
      expect(row(item.id)).toMatchObject({ year: 1980, yearUnk: 1 })
    })

    it('still puts an item back from a payload written before partial years existed', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'Album', timeToConsumeMinutes: 40, year: 1994 }))!
      const deleted = await inject('DELETE', `/lists/${list.id}/items/${item.id}`)
      const before = { ...deleted.json().restore.item }
      delete before.yearUnk

      const restored = await inject('POST', `/lists/${list.id}/items/restore`, { item: before })

      expect(restored.statusCode).toBe(200)
      expect(row(item.id)).toMatchObject({ year: 1994, yearUnk: 0 })
    })

    it('imports items typed by hand with their years, partial ones too (Use Hands)', async () => {
      const list = await newList()

      const response = await inject('POST', `/lists/${list.id}/items/import`, {
        source: 'manual',
        items: [
          { title: 'Fast Five', year: 2011 },
          { title: 'Rehearsal tape', year: 1980, yearUnk: 1 },
          { title: 'No year' },
        ],
      })

      expect(response.statusCode).toBe(201)
      expect((await findListItems(db(), owner, list.id))!.map((item) => [item.title, item.year, item.yearUnk])).toEqual([
        ['Fast Five', 2011, 0],
        ['Rehearsal tape', 1980, 1],
        ['No year', null, 0],
      ])
    })

    it('imports an item whose year does not fit without a year, as an out-of-range year always did', async () => {
      const list = await newList()

      await inject('POST', `/lists/${list.id}/items/import`, { items: [{ title: 'Odd', year: 1994, yearUnk: 1 }] })

      expect((await findListItems(db(), owner, list.id))![0]).toMatchObject({ title: 'Odd', year: null, yearUnk: 0 })
    })
  })
})
