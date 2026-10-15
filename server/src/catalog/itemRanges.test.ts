import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem, findListItems, updateListItem } from './repository.js'
import { InvalidMinutesError } from './durations.js'
import { InvalidYearError } from './years.js'

/**
 * Field validation (H-004, H-006, H-007; owner, 2026-10-15): a typed item year is 1000 to 2100 and a typed length is 1 to
 * 99,999 minutes, enforced where the server and the desktop both go through, so the screens' own checks are never the only
 * ones. What a source gives, and what Undo puts back, was never typed here and is not held to this.
 */
describe('the ranges of a typed item year and length', () => {
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
  const newList = () => createList(db(), owner, { title: 'Movies', mediaType: 'movie' })
  const row = (itemId: string) => db().select().from(listItems).where(eq(listItems.id, itemId)).get()!
  const inject = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, payload: payload as never })

  describe('a year', () => {
    it.each([1000, 1605, 2100])('makes an item with the year %d', async (year) => {
      const list = await newList()

      expect(await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90, year })).toMatchObject({ year })
    })

    it.each([0, 1, 476, 999, 2101, 3000])('refuses to make an item with the year %d', async (year) => {
      const list = await newList()

      await expect(createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90, year })).rejects.toThrow(InvalidYearError)
      expect(await findListItems(db(), owner, list.id)).toEqual([])
    })

    it('refuses 30?? and 211? but takes 21??, which starts at 2100', async () => {
      const list = await newList()
      const make = (year: number, yearUnk: 1 | 2) => createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90, year, yearUnk })

      await expect(make(3000, 2)).rejects.toThrow(InvalidYearError)
      await expect(make(2110, 1)).rejects.toThrow(InvalidYearError)
      expect(await make(2100, 2)).toMatchObject({ year: 2100, yearUnk: 2 })
    })

    it.each([999, 2101, 3500])('refuses to edit an item to the year %d, and changes nothing', async (year) => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90, year: 1994 }))!

      await expect(updateListItem(db(), owner, list.id, item.id, { year })).rejects.toThrow(InvalidYearError)
      expect(row(item.id).year).toBe(1994)
    })

    it('leaves an item stored below 1000 alone when an edit does not send the year', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90, year: 1994 }))!
      db().update(listItems).set({ year: 800 }).where(eq(listItems.id, item.id)).run()

      const updated = await updateListItem(db(), owner, list.id, item.id, { title: 'Renamed' })

      expect(updated).toMatchObject({ title: 'Renamed', year: 800 })
    })

    it('says "item.invalidYear" over the API for 999 and 2101, and takes 1000 and 2100', async () => {
      const list = await newList()
      const post = (year: number) => inject('POST', `/lists/${list.id}/items`, { title: 'x', timeToConsumeMinutes: 90, year })

      expect((await post(999)).json()).toEqual({ code: 'item.invalidYear' })
      expect((await post(2101)).json()).toEqual({ code: 'item.invalidYear' })
      expect((await post(1000)).statusCode).toBe(201)
      expect((await post(2100)).statusCode).toBe(201)
    })
  })

  describe('a length', () => {
    it.each([1, 95, 99_999])('makes an item of %d minutes', async (minutes) => {
      const list = await newList()

      expect(await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: minutes })).toMatchObject({ timeToConsumeMinutes: minutes })
    })

    it.each([0, -1, 1.5, 100_000, 1e308])('refuses to make an item of %d minutes', async (minutes) => {
      const list = await newList()

      await expect(createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: minutes })).rejects.toBeInstanceOf(InvalidMinutesError)
      expect(await findListItems(db(), owner, list.id)).toEqual([])
    })

    it.each([0, 100_000])('refuses to edit an item to %d minutes, and changes nothing', async (minutes) => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90 }))!

      await expect(updateListItem(db(), owner, list.id, item.id, { timeToConsumeMinutes: minutes })).rejects.toBeInstanceOf(InvalidMinutesError)
      expect(row(item.id).timeToConsumeMinutes).toBe(90)
    })

    it('says "item.invalidMinutes" over the API for 0 and 100000, and takes 99999', async () => {
      const list = await newList()
      const item = (await createListItem(db(), owner, list.id, { title: 'x', timeToConsumeMinutes: 90 }))!
      const post = (minutes: number) => inject('POST', `/lists/${list.id}/items`, { title: 'y', timeToConsumeMinutes: minutes })
      const patch = (minutes: number) => inject('PATCH', `/lists/${list.id}/items/${item.id}`, { timeToConsumeMinutes: minutes })

      expect((await post(0)).json()).toEqual({ code: 'item.invalidMinutes' })
      expect((await post(100_000)).json()).toEqual({ code: 'item.invalidMinutes' })
      expect((await patch(0)).json()).toEqual({ code: 'item.invalidMinutes' })
      expect((await patch(100_000)).json()).toEqual({ code: 'item.invalidMinutes' })
      expect((await post(99_999)).statusCode).toBe(201)
      expect((await patch(99_999)).statusCode).toBe(200)
    })
  })
})
