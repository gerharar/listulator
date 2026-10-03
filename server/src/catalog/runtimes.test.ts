import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { itemRuntimes, listItems, listSnapshots, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem, createListSnapshot, findListItems, updateListItem } from './repository.js'
import {
  applyRuntimes,
  knownRuntimes,
  pendingFor,
  pruneExpiredRuntimes,
  recordRuntimes,
  withKnownRuntimes,
} from './runtimes.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-03T12:00:00Z')
const later = (days: number): Date => new Date(NOW.getTime() + days * DAY)

describe('runtime lookups (15.3)', () => {
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

  const db = () => harness.db

  describe('recordRuntimes and knownRuntimes', () => {
    it('remembers a runtime, and remembers "TMDB has none" as a known answer', async () => {
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 97 }, { ref: 'movie:2', minutes: null }], { now: NOW, ttlDays: 150 })

      const known = await knownRuntimes(db(), ['movie:1', 'movie:2', 'movie:3'], NOW)

      expect(known.get('movie:1')).toBe(97)
      expect(known.has('movie:2')).toBe(true)
      expect(known.get('movie:2')).toBeNull()
      expect(known.has('movie:3')).toBe(false)
    })

    it('stores the time it was asked and when the answer lapses', async () => {
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 97 }], { now: NOW, ttlDays: 150 })

      const stored = db().select().from(itemRuntimes).get()!

      expect(stored.fetchedAt).toEqual(NOW)
      expect(stored.expiresAt).toEqual(later(150))
    })

    it('ignores an answer once it has lapsed', async () => {
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 97 }], { now: NOW, ttlDays: 150 })

      expect((await knownRuntimes(db(), ['movie:1'], later(149))).has('movie:1')).toBe(true)
      expect((await knownRuntimes(db(), ['movie:1'], later(150))).has('movie:1')).toBe(false)
    })

    it('replaces an earlier answer for the same film, and its expiry', async () => {
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: null }], { now: NOW, ttlDays: 150 })
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 120 }], { now: later(200), ttlDays: 150 })

      expect((await knownRuntimes(db(), ['movie:1'], later(201))).get('movie:1')).toBe(120)
    })

    it('copes with thousands of refs at once, beyond SQLite’s bound-variable limit (BL-049)', async () => {
      const rows = Array.from({ length: 3500 }, (_, index) => ({ ref: `movie:${index + 1}`, minutes: 90 }))

      await recordRuntimes(db(), rows, { now: NOW, ttlDays: 150 })
      const known = await knownRuntimes(db(), rows.map((row) => row.ref), NOW)

      expect(known.size).toBe(3500)
    })

    it('does nothing for nothing', async () => {
      await recordRuntimes(db(), [], { now: NOW, ttlDays: 150 })

      expect((await knownRuntimes(db(), [], NOW)).size).toBe(0)
    })
  })

  describe('pruneExpiredRuntimes', () => {
    it('deletes only the lapsed answers and says how many', async () => {
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 90 }], { now: NOW, ttlDays: 10 })
      await recordRuntimes(db(), [{ ref: 'movie:2', minutes: 90 }], { now: NOW, ttlDays: 200 })

      expect(await pruneExpiredRuntimes(db(), later(50))).toBe(1)

      expect([...(await knownRuntimes(db(), ['movie:1', 'movie:2'], later(50))).keys()]).toEqual(['movie:2'])
    })
  })

  describe('withKnownRuntimes', () => {
    it('gives a listed film its remembered length, and leaves the rest alone', () => {
      const known = new Map<string, number | null>([['movie:1', 97], ['movie:2', null]])
      const items: { title: string; externalRef?: string; timeToConsumeMinutes?: number }[] = [
        { title: 'A', externalRef: 'movie:1' },
        { title: 'B', externalRef: 'movie:2' },
        { title: 'C', externalRef: 'movie:3' },
        { title: 'D' },
      ]

      const filled = withKnownRuntimes(items, known)

      expect(filled.map((item) => item.timeToConsumeMinutes)).toEqual([97, undefined, undefined, undefined])
      expect(filled[1]).not.toHaveProperty('timeToConsumeMinutes')
    })

    it('never replaces a length the item already has, and does not change its input', () => {
      const items = [{ title: 'A', externalRef: 'movie:1', timeToConsumeMinutes: 45 }]

      expect(withKnownRuntimes(items, new Map([['movie:1', 97]]))[0]?.timeToConsumeMinutes).toBe(45)
      expect(items[0]).toEqual({ title: 'A', externalRef: 'movie:1', timeToConsumeMinutes: 45 })
    })
  })

  describe('pendingFor', () => {
    async function listWith(items: { title: string; externalRef?: string; estimated?: boolean }[]) {
      const list = await createList(db(), userId, { title: 'L', mediaType: 'movie' })
      for (const item of items) {
        await createListItem(db(), userId, list.id, {
          title: item.title,
          timeToConsumeMinutes: 120,
          timeToConsumeIsEstimated: item.estimated ?? true,
          ...(item.externalRef ? { externalRef: item.externalRef } : {}),
        })
      }

      return list
    }

    it('names the films still to look up: estimated, with a ref of an enrichable kind, and no live answer', async () => {
      const list = await listWith([
        { title: 'asked', externalRef: 'movie:1' },
        { title: 'asked, none', externalRef: 'movie:2' },
        { title: 'lapsed', externalRef: 'movie:3' },
        { title: 'new', externalRef: 'movie:4' },
        { title: 'user-set', externalRef: 'movie:5', estimated: false },
        { title: 'by hand' },
        { title: 'episode', externalRef: 'episode:9:1:1' },
      ])
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 90 }, { ref: 'movie:2', minutes: null }], { now: NOW, ttlDays: 150 })
      await recordRuntimes(db(), [{ ref: 'movie:3', minutes: 90 }], { now: later(-200), ttlDays: 150 })

      expect((await pendingFor(db(), list.id, NOW, ['movie'])).sort()).toEqual(['movie:3', 'movie:4'])
    })

    it('names a film once, however many items carry it, and only for the list asked', async () => {
      const list = await listWith([
        { title: 'once', externalRef: 'movie:1' },
        { title: 'twice', externalRef: 'movie:1' },
      ])
      await listWith([{ title: 'other list', externalRef: 'movie:2' }])

      expect(await pendingFor(db(), list.id, NOW, ['movie'])).toEqual(['movie:1'])
    })

    it('asks for nothing when no kind of ref is enrichable', async () => {
      const list = await listWith([{ title: 'a', externalRef: 'movie:1' }])

      expect(await pendingFor(db(), list.id, NOW, [])).toEqual([])
    })

    it('does not let a prefix match part of another (movie is not movies:)', async () => {
      const list = await listWith([{ title: 'a', externalRef: 'movies:1' }, { title: 'b', externalRef: 'movie:1' }])

      expect(await pendingFor(db(), list.id, NOW, ['movie'])).toEqual(['movie:1'])
    })
  })

  describe('applyRuntimes', () => {
    async function listWithSnapshot() {
      const list = await createList(db(), userId, { title: 'L', mediaType: 'movie' })
      await createListItem(db(), userId, list.id, { title: 'A', timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, externalRef: 'movie:1' })
      await createListItem(db(), userId, list.id, { title: 'B', timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, externalRef: 'movie:2' })
      await createListSnapshot(db(), list.id, (await findListItems(db(), userId, list.id))!)

      return list
    }

    it('sets the length on the list’s estimated items and its source copy, and marks them known', async () => {
      const list = await listWithSnapshot()

      const changed = await applyRuntimes(db(), list.id, [{ ref: 'movie:1', minutes: 97 }])

      const items = (await findListItems(db(), userId, list.id))!
      expect(changed).toBe(1)
      expect(items.find((item) => item.externalRef === 'movie:1')).toMatchObject({ timeToConsumeMinutes: 97, timeToConsumeIsEstimated: false })
      expect(items.find((item) => item.externalRef === 'movie:2')).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })

      const copy = db().select().from(listSnapshots).where(eq(listSnapshots.externalRef, 'movie:1')).get()!
      expect(copy).toMatchObject({ timeToConsumeMinutes: 97, timeToConsumeIsEstimated: false })
    })

    it('never overwrites a time the user set, even after an edit', async () => {
      const list = await listWithSnapshot()
      const item = (await findListItems(db(), userId, list.id))!.find((entry) => entry.externalRef === 'movie:1')!
      await updateListItem(db(), userId, list.id, item.id, { timeToConsumeMinutes: 55, timeToConsumeIsEstimated: false })

      expect(await applyRuntimes(db(), list.id, [{ ref: 'movie:1', minutes: 97 }])).toBe(0)

      const after = db().select().from(listItems).where(and(eq(listItems.listId, list.id), eq(listItems.externalRef, 'movie:1'))).get()!
      expect(after).toMatchObject({ timeToConsumeMinutes: 55, timeToConsumeIsEstimated: false })
    })

    it('touches only the list it is given', async () => {
      const list = await listWithSnapshot()
      const other = await createList(db(), userId, { title: 'Other', mediaType: 'movie' })
      await createListItem(db(), userId, other.id, { title: 'A', timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, externalRef: 'movie:1' })

      await applyRuntimes(db(), list.id, [{ ref: 'movie:1', minutes: 97 }])

      expect((await findListItems(db(), userId, other.id))![0]).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('does nothing for no rows', async () => {
      const list = await listWithSnapshot()

      expect(await applyRuntimes(db(), list.id, [])).toBe(0)
    })
  })
})
