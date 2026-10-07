import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listGroups, listItems, lists, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems, discardList, itemFromFile, itemFromSource } from './bulkItems.js'
import {
  createList,
  createListItem,
  createListSnapshot,
  findListItems,
  findListSnapshot,
  type CreateListItemInput,
} from './repository.js'

type Input = Omit<CreateListItemInput, 'orderIndex'>

describe('bulk item insert (15.9b)', () => {
  let harness: TestApp
  let userId: string
  let strangerId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    userId = harness.db.select().from(users).get()!.id
    strangerId = harness.db.insert(users).values({}).returning().get().id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db
  const newList = (title = 'L') => createList(db(), userId, { title, mediaType: 'movie' })

  const item = (title: string, group?: string | null, extra: Partial<Input> = {}): Input => ({
    title,
    timeToConsumeMinutes: 90,
    ...(group !== undefined ? { group } : {}),
    ...extra,
  })

  /** Everything that is not an id or a timestamp, in list order: what "the same list" means. */
  async function snapshotOf(listId: string) {
    const rows = (await findListItems(db(), userId, listId))!.map((row) => ({
      title: row.title,
      orderIndex: row.orderIndex,
      group: row.group,
      minutes: row.timeToConsumeMinutes,
      estimated: row.timeToConsumeIsEstimated,
      externalRef: row.externalRef,
      source: row.source,
      year: row.year,
      tags: row.tags,
      notes: row.notes,
      isNew: row.isNew,
    }))
    const groups = db()
      .select()
      .from(listGroups)
      .where(eq(listGroups.listId, listId))
      .all()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((group) => ({ name: group.name, orderIndex: group.orderIndex }))

    return { rows, groups }
  }

  async function sequentially(listId: string, inputs: Input[]) {
    for (const input of inputs) await createListItem(db(), userId, listId, input)
  }

  describe('equals what createListItem one by one makes', () => {
    /** A small deterministic generator, so a failing seed can be replayed. */
    function random(seed: number) {
      let state = seed
      return () => {
        state = (state * 1664525 + 1013904223) % 4294967296

        return state / 4294967296
      }
    }

    const LABELS = [undefined, null, '', '  ', 'Season 1', 'season 1', ' Season 1 ', 'Season 2', 'Extras', 'Special']

    function sequence(next: () => number, count: number, prefix: string): Input[] {
      return Array.from({ length: count }, (_, index) => {
        const label = LABELS[Math.floor(next() * LABELS.length)]

        return item(`${prefix}${index}`, label, {
          timeToConsumeIsEstimated: next() < 0.5,
          year: next() < 0.5 ? 1990 + Math.floor(next() * 30) : null,
          tags: next() < 0.3 ? [' Live ', 'live', 'Album'] : null,
          notes: next() < 0.2 ? 'a note' : null,
          externalRef: next() < 0.5 ? `movie:${index}` : null,
          isNew: next() < 0.3,
        })
      })
    }

    it.each(Array.from({ length: 120 }, (_, index) => index + 1))(
      'for a random mix of grouped and ungrouped items, into an empty list and into one with items (seed %i)',
      async (seed) => {
        const next = random(seed)
        const existing = sequence(next, Math.floor(next() * 9), 'old')
        const added = sequence(next, 1 + Math.floor(next() * 25), 'new')

        const a = await newList('sequential')
        const b = await newList('bulk')
        await sequentially(a.id, existing)
        await sequentially(b.id, existing)

        await sequentially(a.id, added)
        await createListItems(db(), userId, b.id, added)

        expect(await snapshotOf(b.id)).toEqual(await snapshotOf(a.id))
      },
    )

    it('also across several statements: more items than fit in one, mixed, into a list that already has items', async () => {
      const next = random(4242)
      const existing = sequence(next, 12, 'old')
      const added = sequence(next, 620, 'new')

      const a = await newList('sequential')
      const b = await newList('bulk')
      await sequentially(a.id, existing)
      await sequentially(b.id, existing)

      await sequentially(a.id, added)
      const created = (await createListItems(db(), userId, b.id, added))!

      expect(await snapshotOf(b.id)).toEqual(await snapshotOf(a.id))
      expect(created.map((row) => row.title)).toEqual(added.map((input) => input.title))
    })

    it('also when the list already has gaps in its order and a group with no items', async () => {
      const a = await newList('sequential')
      const b = await newList('bulk')
      for (const id of [a.id, b.id]) {
        await sequentially(id, [item('x', 'A'), item('y', 'B'), item('z', 'A')])
        // A gap, as a deleted item leaves.
        const rows = db().select().from(listItems).where(eq(listItems.listId, id)).all()
        const y = rows.find((row) => row.title === 'y')!
        db().update(listItems).set({ orderIndex: 10 }).where(eq(listItems.id, y.id)).run()
        // A group row nothing belongs to.
        db().insert(listGroups).values({ listId: id, name: 'Empty', orderIndex: 5 }).run()
      }
      const added = [item('n1', 'B'), item('n2', 'Empty'), item('n3', 'A'), item('n4', null)]

      await sequentially(a.id, added)
      await createListItems(db(), userId, b.id, added)

      expect(await snapshotOf(b.id)).toEqual(await snapshotOf(a.id))
    })
  })

  describe('what it returns', () => {
    it('is the new rows in the order given, with their final positions', async () => {
      const list = await newList()
      await sequentially(list.id, [item('a', 'S1'), item('b', 'S2')])

      const created = (await createListItems(db(), userId, list.id, [item('c', 'S1'), item('d', 'S2'), item('e', 'S1')]))!

      expect(created.map((row) => row.title)).toEqual(['c', 'd', 'e'])
      const stored = (await findListItems(db(), userId, list.id))!
      for (const row of created) expect(stored.find((entry) => entry.id === row.id)?.orderIndex).toBe(row.orderIndex)
      expect(stored.map((row) => row.title)).toEqual(['a', 'c', 'e', 'b', 'd'])
    })

    it('is undefined for a list that is not there or not the user’s, and writes nothing', async () => {
      const list = await newList()

      expect(await createListItems(db(), strangerId, list.id, [item('a')])).toBeUndefined()
      expect(await createListItems(db(), userId, 'no-such-list', [item('a')])).toBeUndefined()
      expect(db().select().from(listItems).all()).toEqual([])
    })

    it('is an empty list for nothing, and touches nothing', async () => {
      const list = await newList()

      expect(await createListItems(db(), userId, list.id, [])).toEqual([])
    })

    it('leaves another list alone', async () => {
      const other = await newList('other')
      await sequentially(other.id, [item('o1', 'S1')])
      const list = await newList()

      await createListItems(db(), userId, list.id, [item('a', 'S1'), item('b', 'S1')])

      expect((await snapshotOf(other.id)).rows.map((row) => row.title)).toEqual(['o1'])
    })
  })

  describe('groups', () => {
    it('makes a group once, spelled as its first item spells it, and trims the label', async () => {
      const list = await newList()

      await createListItems(db(), userId, list.id, [item('a', ' Season 1 '), item('b', 'season 1'), item('c', 'SEASON 1')])

      const { rows, groups } = await snapshotOf(list.id)
      expect(groups).toEqual([{ name: 'Season 1', orderIndex: 0 }])
      expect(rows.map((row) => row.group)).toEqual(['Season 1', 'Season 1', 'Season 1'])
    })

    it('uses the spelling the list already has for a group', async () => {
      const list = await newList()
      await sequentially(list.id, [item('a', 'Season 1')])

      await createListItems(db(), userId, list.id, [item('b', 'SEASON 1')])

      expect((await snapshotOf(list.id)).rows.map((row) => row.group)).toEqual(['Season 1', 'Season 1'])
    })
  })

  describe('big lists', () => {
    it('inserts three thousand items, past the bound-variable limit of one statement', async () => {
      const list = await newList()
      const many = Array.from({ length: 3000 }, (_, index) => item(`F${index}`, `Season ${Math.floor(index / 25)}`, { externalRef: `movie:${index}` }))

      const created = await createListItems(db(), userId, list.id, many)

      expect(created).toHaveLength(3000)
      expect((await findListItems(db(), userId, list.id))!).toHaveLength(3000)
    })

    it('snapshots three thousand items too (BL-049)', async () => {
      const list = await newList()
      const many = Array.from({ length: 3000 }, (_, index) => item(`F${index}`, null, { externalRef: `movie:${index}` }))
      await createListItems(db(), userId, list.id, many)

      await createListSnapshot(db(), list.id, (await findListItems(db(), userId, list.id))!)

      expect(await findListSnapshot(db(), userId, list.id)).toHaveLength(3000)
    })
  })

  describe('when a chunk fails', () => {
    /** The 501st item cannot be stored: its length is not a number. */
    const poisoned = (count: number): Input[] =>
      Array.from({ length: count }, (_, index) => item(`F${index}`, `G${index % 3}`, index === 500 ? { timeToConsumeMinutes: null as unknown as number } : {}))

    it('leaves the list as it was: no new rows, no new groups, the old order intact', async () => {
      const list = await newList()
      await sequentially(list.id, [item('a', 'G0'), item('b', 'Other'), item('c', 'G0')])
      const before = await snapshotOf(list.id)

      await expect(createListItems(db(), userId, list.id, poisoned(700))).rejects.toThrow()

      const after = await snapshotOf(list.id)
      expect(after.rows.map((row) => row.title)).toEqual(before.rows.map((row) => row.title))
      expect(after.groups).toEqual(before.groups)
    })

    it('lets a create path remove the list it just made, so a failed import leaves nothing', async () => {
      const list = await newList('half-made')

      await expect(createListItems(db(), userId, list.id, poisoned(700))).rejects.toThrow()
      await discardList(db(), userId, list.id)

      expect(db().select().from(lists).where(eq(lists.id, list.id)).all()).toEqual([])
      expect(db().select().from(listItems).all()).toEqual([])
    })

    it('discardList removes only the user’s own list, and says nothing when there is none', async () => {
      const list = await newList()

      await discardList(db(), strangerId, list.id)
      expect(db().select().from(lists).where(eq(lists.id, list.id)).all()).toHaveLength(1)

      await discardList(db(), userId, 'no-such-list')
    })
  })
})

describe('a new item from what a source said (one rule for every import path)', () => {
  it('takes the source’s own length when it knows one, not estimated', () => {
    expect(itemFromSource({ title: 'Heat', estimatedMinutes: 40 }, 170, 100)).toEqual({
      title: 'Heat',
      timeToConsumeMinutes: 170,
      timeToConsumeIsEstimated: false,
      source: 'import',
    })
  })

  it('falls back to the source’s better guess, then the category default, marked estimated', () => {
    expect(itemFromSource({ title: 'DLC', estimatedMinutes: 240 }, undefined, 600)).toMatchObject({
      timeToConsumeMinutes: 240,
      timeToConsumeIsEstimated: true,
    })
    expect(itemFromSource({ title: 'Film' }, undefined, 100)).toMatchObject({ timeToConsumeMinutes: 100, timeToConsumeIsEstimated: true })
  })

  it('carries what the source knows and leaves out what is empty', () => {
    expect(
      itemFromSource(
        { title: 'E1', externalRef: 'tmdb:1', year: 2001, group: 'S1', tags: ['Pilot'], notes: 'Cut' },
        42,
        30,
      ),
    ).toEqual({
      title: 'E1',
      timeToConsumeMinutes: 42,
      timeToConsumeIsEstimated: false,
      externalRef: 'tmdb:1',
      year: 2001,
      group: 'S1',
      tags: ['Pilot'],
      notes: 'Cut',
      source: 'import',
    })
    expect(itemFromSource({ title: 'Bare', externalRef: '', group: '', notes: '' }, 1, 30)).toEqual({
      title: 'Bare',
      timeToConsumeMinutes: 1,
      timeToConsumeIsEstimated: false,
      source: 'import',
    })
    // A stored row's nulls, as Reset reads them.
    expect(itemFromSource({ title: 'Bare', externalRef: null, year: null, group: null, tags: null, notes: null }, 1, 30)).toEqual({
      title: 'Bare',
      timeToConsumeMinutes: 1,
      timeToConsumeIsEstimated: false,
      source: 'import',
    })
  })
})

describe('a new item from a list file', () => {
  it('takes the file’s minutes, or the category default marked estimated', () => {
    expect(itemFromFile({ title: 'A', minutes: 90 }, 30)).toEqual({ title: 'A', timeToConsumeMinutes: 90, timeToConsumeIsEstimated: false, source: 'import' })
    expect(itemFromFile({ title: 'B' }, 30)).toEqual({ title: 'B', timeToConsumeMinutes: 30, timeToConsumeIsEstimated: true, source: 'import' })
  })

  it('keeps every field the file wrote, an empty one included, as the file paths always have', () => {
    expect(itemFromFile({ title: 'C', year: 1999, group: '', tags: [], notes: '' }, 30)).toEqual({
      title: 'C',
      timeToConsumeMinutes: 30,
      timeToConsumeIsEstimated: true,
      year: 1999,
      group: '',
      tags: [],
      notes: '',
      source: 'import',
    })
  })
})

describe('a row never carries a number the app cannot show (SR-019)', () => {
  const hostileMinutes = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5, 0, 1.5, 1e308, 100_001]
  const hostileYears = [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 2000.5, 1e308, 10_000]

  it.each(hostileMinutes)('a list file’s minutes of %s become the default, marked estimated', (minutes) => {
    expect(itemFromFile({ title: 'A', minutes }, 120)).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
  })

  it.each(hostileYears)('a list file’s year of %s is left out', (year) => {
    expect(itemFromFile({ title: 'A', year }, 120)).not.toHaveProperty('year')
  })

  it('keeps a file’s ordinary numbers as written', () => {
    expect(itemFromFile({ title: 'A', minutes: 109, year: 1962 }, 120)).toMatchObject({ timeToConsumeMinutes: 109, timeToConsumeIsEstimated: false, year: 1962 })
  })

  it.each(hostileMinutes)('a source’s length of %s becomes its own estimate or the default, marked estimated', (minutes) => {
    expect(itemFromSource({ title: 'A' }, minutes, 100)).toMatchObject({ timeToConsumeMinutes: 100, timeToConsumeIsEstimated: true })
    expect(itemFromSource({ title: 'A', estimatedMinutes: 240 }, minutes, 100)).toMatchObject({ timeToConsumeMinutes: 240, timeToConsumeIsEstimated: true })
  })

  it.each(hostileMinutes)('a source’s own estimate of %s is not used either', (estimatedMinutes) => {
    expect(itemFromSource({ title: 'A', estimatedMinutes }, undefined, 100)).toMatchObject({ timeToConsumeMinutes: 100, timeToConsumeIsEstimated: true })
  })

  it.each(hostileYears)('a source’s year of %s is left out', (year) => {
    expect(itemFromSource({ title: 'A', year }, 90, 100)).not.toHaveProperty('year')
  })

  it('keeps a source’s ordinary numbers as given', () => {
    expect(itemFromSource({ title: 'A', year: 1962 }, 109, 100)).toMatchObject({ timeToConsumeMinutes: 109, timeToConsumeIsEstimated: false, year: 1962 })
  })
})
