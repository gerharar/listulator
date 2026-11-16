import type BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/client.js'
import { dismissedItems, listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems, createListWithItems, itemFromSource } from './bulkItems.js'
import { restoreConsumed, setItemsConsumed } from './consumed.js'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'
import { dropSourceCopy, refreshSourceCopy } from './sourceCopy.js'
import { resetToSource, sortChronologically } from './reset.js'
import { createList as createStoredList, deleteList, findList, findListItems, reorderListItems } from './repository.js'
import { restoreItemSet, restoreList, restoreListGroup, restoreOrder } from './restore.js'
import { deleteListGroup, findListGroups, renameListGroup, reorderListGroups } from './groups.js'

/**
 * Phase 53, task 53.5a: Reset to the source and its Undo are all or nothing. A process that dies in the middle of either leaves the list
 * exactly as it was, with no clean-up code to run: "dies" is made here the way the process does it, every write after the Nth fails, the
 * statements of a catch block included (the desktop's own kill simulation, `docs/tasks/53.0-spike-notes.md`, did the same to find the
 * 23,000 of 30,000 items). Over the server's driver; the desktop's is `api.local.test.ts`.
 */
const USER = 'u1'
const GAME = { key: 'game', defaultDurationMinutes: 600 }

/** A source of 600 items in six groups: three insert statements of 250 rows. */
const SOURCE = `title: The source\ncategory: game\nitems:\n${Array.from(
  { length: 600 },
  (_, n) => `  - { title: "Source ${n}", year: ${1990 + (n % 30)}, minutes: ${20 + (n % 90)}, group: "Arc ${n % 6}" }`,
).join('\n')}\n`

let harness: TestApp

function client(db: AppDatabase): BetterSqlite3.Database {
  return (db as unknown as { $client: BetterSqlite3.Database }).$client
}

/** Everything the list holds, as the database has it (ids, positions, times, ticks): comparable before and after. */
function snapshot(db: AppDatabase, listId: string) {
  const all = (query: string) => client(db).prepare(query).all(listId)

  return {
    list: all('SELECT * FROM lists WHERE id = ?'),
    items: all('SELECT * FROM list_items WHERE list_id = ? ORDER BY id'),
    groups: all('SELECT * FROM list_groups WHERE list_id = ? ORDER BY id'),
    dismissals: all('SELECT * FROM dismissed_items WHERE list_id = ? ORDER BY id'),
    snapshots: all('SELECT * FROM list_snapshots WHERE list_id = ? ORDER BY id'),
  }
}

/** A list that is not what its source says: hand-made items, ticks, a dismissal, groups of its own. */
async function aList(): Promise<string> {
  const { db } = harness
  await db.insert(users).values({ id: USER, isDefaultLocalUser: false })
  const list = await createStoredList(db, USER, { title: 'Mine', mediaType: 'game', source: 'file', sourceYaml: SOURCE })
  await createListItems(
    db,
    USER,
    list.id,
    Array.from({ length: 40 }, (_, n) => ({
      title: `Hand ${n}`,
      timeToConsumeMinutes: 10,
      timeToConsumeIsEstimated: false,
      group: `Old ${n % 3}`,
      year: 2000 + n,
    })),
  )
  await db.update(listItems).set({ consumedAt: new Date(1_700_000_000_000), userNote: 'mine' }).where(eq(listItems.listId, list.id)).run()
  await db.insert(dismissedItems).values([
    { listId: list.id, titleKey: 'gone one' },
    { listId: list.id, titleKey: 'gone two', externalRef: 'x:2' },
  ])

  return list.id
}

/** From now on every WRITE after the `allowed`th fails, whatever statement it is (a read, a BEGIN and a COMMIT still work). */
function dieAfterWrites(db: AppDatabase, allowed: number) {
  const connection = client(db)
  const real = connection.prepare.bind(connection)
  let writes = 0
  connection.prepare = ((query: string) => {
    const statement = real(query)
    const read = /^\s*(select|with)\b/i.test(query) && !/\breturning\b/i.test(query)
    const control = /^\s*(begin|commit|rollback|savepoint|release)\b/i.test(query)
    if (read || control) return statement
    writes += 1
    if (writes > allowed) throw new Error('process killed')

    return statement
  }) as typeof connection.prepare

  return { writes: () => writes, revive: () => void (connection.prepare = real) }
}

const reset = (listId: string) => resetToSource(harness.db, USER, listId, { mediaTypes: [GAME] })

beforeEach(() => {
  harness = createTestApp()
})
afterEach(async () => {
  await harness.cleanup()
})

describe('Reset to the source, killed at any write', () => {
  it('leaves the list exactly as it was, wherever the process dies', async () => {
    // How many writes a whole Reset makes.
    const counting = await aList()
    const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
    await reset(counting)
    const total = meter.writes()
    meter.revive()
    expect(total).toBeGreaterThanOrEqual(8)
    await harness.cleanup()

    const points = [0, 1, 2, 3, Math.floor(total / 2), total - 3, total - 2, total - 1]
    for (const allowed of points) {
      harness = createTestApp()
      const listId = await aList()
      const before = snapshot(harness.db, listId)

      const death = dieAfterWrites(harness.db, allowed)
      await expect(reset(listId), `killed after ${allowed} of ${total} writes`).rejects.toThrow()
      death.revive()

      expect(snapshot(harness.db, listId), `killed after ${allowed} of ${total} writes`).toEqual(before)
      await harness.cleanup()
    }
    harness = createTestApp()
  })

  it('still resets when nothing kills it, to the source and with a clean slate', async () => {
    const listId = await aList()

    const result = await reset(listId)

    expect(result?.counts.removed).toBe(40)
    const after = snapshot(harness.db, listId)
    expect(after.items).toHaveLength(600)
    expect(after.groups).toHaveLength(6)
    expect(after.dismissals).toHaveLength(0)
    expect((after.list[0] as { title: string }).title).toBe('The source')
  })
})

describe('Undo of a Reset, killed at any write', () => {
  it('leaves the list as the Reset made it, and an Undo that is not killed puts everything back', async () => {
    // How many writes an Undo makes.
    const counting = await aList()
    const done = await reset(counting)
    const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
    await restoreItemSet(harness.db, USER, counting, done!.restore)
    const total = meter.writes()
    meter.revive()
    expect(total).toBeGreaterThanOrEqual(6)
    await harness.cleanup()

    harness = createTestApp()
    const listId = await aList()
    const original = snapshot(harness.db, listId)
    const restore = (await reset(listId))!.restore
    const afterReset = snapshot(harness.db, listId)

    for (const allowed of [0, 1, 2, Math.floor(total / 2), total - 2, total - 1]) {
      const death = dieAfterWrites(harness.db, allowed)
      await expect(restoreItemSet(harness.db, USER, listId, restore), `killed after ${allowed} of ${total} writes`).rejects.toThrow()
      death.revive()

      expect(snapshot(harness.db, listId), `killed after ${allowed} of ${total} writes`).toEqual(afterReset)
    }

    await restoreItemSet(harness.db, USER, listId, restore)
    const restored = snapshot(harness.db, listId)
    expect(restored.items).toEqual(original.items)
    expect(restored.groups).toEqual(original.groups)
    expect(restored.dismissals).toEqual(original.dismissals)
  })
})

/** Everything a list leaves in the database, counted over all lists: after a create that was killed it must all be zero. */
function totals(db: AppDatabase) {
  const count = (table: string) => (client(db).prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n

  return { lists: count('lists'), items: count('list_items'), groups: count('list_groups'), snapshots: count('list_snapshots'), dismissals: count('dismissed_items') }
}

/** 600 candidates in six groups with years, as a source or a file would give them. */
const candidates = Array.from({ length: 600 }, (_, n) => ({
  title: `Candidate ${n}`,
  year: 1990 + (n % 30),
  group: `Arc ${n % 6}`,
  externalRef: `c:${n}`,
}))
const asItems = () => candidates.map((candidate) => itemFromSource(candidate, 25, 30))
const newList = { title: 'Imported', mediaType: 'game', source: 'api' as const, externalRef: 'franchise:1', arrivedTitle: 'Imported', snapshotFetchedAt: new Date(1_700_000_000_000) }

describe('Creating a list (from a source or a file), killed at any write', () => {
  it('leaves no list, item, group or snapshot behind, wherever the process dies', async () => {
    await harness.db.insert(users).values({ id: USER, isDefaultLocalUser: false })
    const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
    const made = await createListWithItems(harness.db, USER, newList, asItems(), { snapshot: true })
    const total = meter.writes()
    meter.revive()
    expect(made.title).toBe('Imported')
    expect(totals(harness.db)).toEqual({ lists: 1, items: 600, groups: 6, snapshots: 600, dismissals: 0 })
    expect(total).toBeGreaterThanOrEqual(8)
    await harness.cleanup()

    for (const allowed of [0, 1, 2, 3, Math.floor(total / 2), total - 2, total - 1]) {
      harness = createTestApp()
      await harness.db.insert(users).values({ id: USER, isDefaultLocalUser: false })

      const death = dieAfterWrites(harness.db, allowed)
      await expect(createListWithItems(harness.db, USER, newList, asItems(), { snapshot: true }), `killed after ${allowed} of ${total} writes`).rejects.toThrow()
      death.revive()

      expect(totals(harness.db), `killed after ${allowed} of ${total} writes`).toEqual({ lists: 0, items: 0, groups: 0, snapshots: 0, dismissals: 0 })
      await harness.cleanup()
    }
    harness = createTestApp()
  })

  it('makes the list a source gives: its rows, its snapshot as the items stand, its groups in year order', async () => {
    await harness.db.insert(users).values({ id: USER, isDefaultLocalUser: false })

    const made = await createListWithItems(harness.db, USER, newList, asItems(), { snapshot: false })

    expect(totals(harness.db)).toEqual({ lists: 1, items: 600, groups: 6, snapshots: 0, dismissals: 0 })
    const groups = client(harness.db).prepare('SELECT name, order_index FROM list_groups WHERE list_id = ? ORDER BY order_index').all(made.id) as { name: string; order_index: number }[]
    expect(groups.map((group) => group.order_index)).toEqual([0, 1, 2, 3, 4, 5])
    // Arc 0 holds 1990, Arc 1 holds 1991 ...: already in year order, so nothing moved.
    expect(groups.map((group) => group.name)).toEqual(['Arc 0', 'Arc 1', 'Arc 2', 'Arc 3', 'Arc 4', 'Arc 5'])
  })
})

describe('Adding items to a list, killed at any write', () => {
  it('leaves the list exactly as it was, its dismissals included, wherever the process dies', async () => {
    const run = (listId: string) =>
      createListItems(harness.db, USER, listId, asItems(), { seedGroupOrder: true, clearDismissalsFor: [{ title: 'Gone One' }, { title: 'Candidate 3', externalRef: 'c:3' }] })

    const counting = await aList()
    const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
    await run(counting)
    const total = meter.writes()
    meter.revive()
    expect(total).toBeGreaterThanOrEqual(6)
    expect((snapshot(harness.db, counting).dismissals as unknown[]).length).toBe(1)
    await harness.cleanup()

    for (const allowed of [0, 1, 2, Math.floor(total / 2), total - 2, total - 1]) {
      harness = createTestApp()
      const listId = await aList()
      const before = snapshot(harness.db, listId)

      const death = dieAfterWrites(harness.db, allowed)
      await expect(run(listId), `killed after ${allowed} of ${total} writes`).rejects.toThrow()
      death.revive()

      expect(snapshot(harness.db, listId), `killed after ${allowed} of ${total} writes`).toEqual(before)
      await harness.cleanup()
    }
    harness = createTestApp()
  })
})

/**
 * 1,200 items in six groups with years in no useful order: more than two batches of 500 positions, so a move is several statements.
 * Returns the list's id.
 */
async function aBigList(): Promise<string> {
  const { db } = harness
  await db.insert(users).values({ id: USER, isDefaultLocalUser: false })
  const list = await createStoredList(db, USER, { title: 'Big', mediaType: 'game' })
  await createListItems(
    db,
    USER,
    list.id,
    Array.from({ length: 1200 }, (_, n) => ({
      title: `Item ${n}`,
      timeToConsumeMinutes: 10,
      timeToConsumeIsEstimated: false,
      group: `G${n % 6}`,
      year: 1950 + ((n * 37) % 70),
    })),
  )

  return list.id
}

/**
 * Runs `make` on a fresh database once to count the writes its operation makes, then on a fresh database for each of several kill points:
 * every write after the Nth fails, and the list must be exactly as `make` left it.
 */
async function killedAtEveryWrite(make: () => Promise<{ listId: string; run: () => Promise<unknown> }>): Promise<number> {
  await harness.cleanup()
  harness = createTestApp()
  const counting = await make()
  const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
  await counting.run()
  const total = meter.writes()
  meter.revive()
  await harness.cleanup()
  expect(total).toBeGreaterThanOrEqual(2)

  // Every write count the operation really has, but never one past its last write (nothing would fail there).
  for (const allowed of [...new Set([0, 1, 2, Math.floor(total / 2), total - 1])].filter((n) => n < total)) {
    harness = createTestApp()
    const { listId, run } = await make()
    const before = snapshot(harness.db, listId)

    const death = dieAfterWrites(harness.db, allowed)
    await expect(run(), `killed after ${allowed} of ${total} writes`).rejects.toThrow()
    death.revive()

    expect(snapshot(harness.db, listId), `killed after ${allowed} of ${total} writes`).toEqual(before)
    await harness.cleanup()
  }
  harness = createTestApp()

  return total
}

describe('Moving things around, killed at any write (53.5c)', () => {
  it('Sort chronologically leaves the order exactly as it was', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()

      return { listId, run: () => sortChronologically(harness.db, USER, listId) }
    })
  })

  it('a whole reorder by ids leaves the order exactly as it was', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()
      const ids = (await findListItems(harness.db, USER, listId))!.map((item) => item.id).reverse()

      return { listId, run: () => reorderListItems(harness.db, USER, listId, ids) }
    })
  })

  it('a reorder of the groups (the groups and their items move together) leaves everything as it was', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()
      const ids = (await findListGroups(harness.db, USER, listId))!.map((group) => group.id).reverse()

      return { listId, run: () => reorderListGroups(harness.db, USER, listId, ids) }
    })
  })

  it('Undo of a sort (restore order) leaves the list as the sort made it, and a restore that is not killed puts the order back', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()
      const restore = (await sortChronologically(harness.db, USER, listId))!

      return { listId, run: () => restoreOrder(harness.db, USER, listId, restore) }
    })

    const listId = await aBigList()
    const original = snapshot(harness.db, listId)
    const restore = (await sortChronologically(harness.db, USER, listId))!
    expect(snapshot(harness.db, listId).items).not.toEqual(original.items)

    await restoreOrder(harness.db, USER, listId, restore)

    expect(snapshot(harness.db, listId).items).toEqual(original.items)
    expect(snapshot(harness.db, listId).groups).toEqual(original.groups)
  })
})

/** 1,100 items in one group ("Big": three batches of dismissals) and 30 in two more, so a group's deletion shifts the others. */
async function aListWithABigGroup(bigSize = 1100): Promise<string> {
  const { db } = harness
  await db.insert(users).values({ id: USER, isDefaultLocalUser: false })
  const list = await createStoredList(db, USER, { title: 'Grouped', mediaType: 'game' })
  const item = (title: string, group: string, n: number) => ({ title, timeToConsumeMinutes: 10, timeToConsumeIsEstimated: false, group, year: 1990 + (n % 30), externalRef: `x:${title}` })
  await createListItems(
    db,
    USER,
    list.id,
    [
      ...Array.from({ length: 15 }, (_, n) => item(`First ${n}`, 'First', n)),
      ...Array.from({ length: bigSize }, (_, n) => item(`Big ${n}`, 'Big', n)),
      ...Array.from({ length: 15 }, (_, n) => item(`Last ${n}`, 'Last', n)),
    ],
    { seedGroupOrder: true },
  )

  return list.id
}

const groupNamed = async (listId: string, name: string) => (await findListGroups(harness.db, USER, listId))!.find((group) => group.name === name)!

describe('Group operations, killed at any write (53.5d)', () => {
  it('renaming a group leaves the group and its items as they were', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aListWithABigGroup(40)
      const group = await groupNamed(listId, 'Big')

      return { listId, run: () => renameListGroup(harness.db, USER, listId, group.id, 'Renamed') }
    })
  })

  it('deleting a group with its items (and the record that they were not wanted) leaves everything as it was', async () => {
    const writes = await killedAtEveryWrite(async () => {
      const listId = await aListWithABigGroup()
      const group = await groupNamed(listId, 'Big')

      return { listId, run: () => deleteListGroup(harness.db, USER, listId, group.id, { withItems: true }) }
    })
    expect(writes).toBeGreaterThanOrEqual(5)
  })

  it('Undo of a group deletion leaves the list as the deletion made it', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aListWithABigGroup()
      const group = await groupNamed(listId, 'Big')
      const restore = (await deleteListGroup(harness.db, USER, listId, group.id, { withItems: true }))!

      return { listId, run: () => restoreListGroup(harness.db, USER, listId, restore) }
    })
  })

  it('Undo of the deletion of a group of 2,100 items is a handful of statements, not one per dismissal (the desktop refuses a call over 2,000)', async () => {
    const listId = await aListWithABigGroup(2100)
    const group = await groupNamed(listId, 'Big')
    const before = snapshot(harness.db, listId)
    const restore = (await deleteListGroup(harness.db, USER, listId, group.id, { withItems: true }))!
    expect(restore.dismissalIds).toHaveLength(2100)

    const meter = dieAfterWrites(harness.db, Number.POSITIVE_INFINITY)
    await restoreListGroup(harness.db, USER, listId, restore)
    const writes = meter.writes()
    meter.revive()

    expect(writes).toBeLessThanOrEqual(15)
    const after = snapshot(harness.db, listId)
    expect(after.dismissals).toEqual(before.dismissals)
    expect(after.items).toEqual(before.items)
    expect(after.groups).toEqual(before.groups)
  })

  it('marking many items done, and the Undo of it, leave the items as they were', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()
      const ids = (await findListItems(harness.db, USER, listId))!.map((item) => item.id)

      return { listId, run: () => setItemsConsumed(harness.db, USER, listId, ids, true) }
    })
    await killedAtEveryWrite(async () => {
      const listId = await aBigList()
      const ids = (await findListItems(harness.db, USER, listId))!.map((item) => item.id)
      // Half of them were open (one statement per batch), half were done on a day of their own (a CASE per batch).
      const restore = { items: ids.map((id, n) => ({ id, consumedAt: n < 600 ? null : new Date(1_700_000_000_000 + n * 1000).toISOString() })) }

      return { listId, run: () => restoreConsumed(harness.db, USER, listId, restore) }
    })
  })
})

/** A list fetched from a source, with a copy of it: 600 snapshot rows in three inserts. Gives its id. */
async function aFetchedList(): Promise<string> {
  await harness.db.insert(users).values({ id: USER, isDefaultLocalUser: false })
  const made = await createListWithItems(harness.db, USER, newList, asItems(), { snapshot: true })

  return made.id
}

const fakeSource = createMediaTypeRegistry([
  {
    key: 'game',
    label: 'Game',
    sortOrder: 1,
    defaultDurationMinutes: 600,
    sourceName: 'Fake',
    sourceCopyMaxDays: 30,
    adapter: {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => ({ items: Array.from({ length: 600 }, (_, n) => ({ title: `Fresh ${n}`, externalRef: `f:${n}`, timeToConsumeMinutes: 20 })), status: 'ongoing' }),
    },
  },
]).list()

describe('The stored source copy, killed at any write (53.5d)', () => {
  it('refreshing the copy leaves the old copy and the list as they were', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aFetchedList()
      const list = (await findList(harness.db, USER, listId))!

      return { listId, run: () => refreshSourceCopy(harness.db, list, { mediaTypes: fakeSource }) }
    })
  })

  it('dropping the copy leaves the copy and the list as they were', async () => {
    await killedAtEveryWrite(async () => {
      const listId = await aFetchedList()
      const list = (await findList(harness.db, USER, listId))!

      return { listId, run: () => dropSourceCopy(harness.db, list) }
    })
  })
})

describe('Undo of deleting a list, killed at any write (53.5d)', () => {
  it('leaves no list, item, group, snapshot row or dismissal behind', async () => {
    const writes = await killedAtEveryWrite(async () => {
      const listId = await aFetchedList()
      await harness.db.insert(dismissedItems).values([{ listId, titleKey: 'gone one' }, { listId, titleKey: 'gone two', externalRef: 'x:2' }])
      const restore = (await deleteList(harness.db, USER, listId))!
      expect(totals(harness.db)).toEqual({ lists: 0, items: 0, groups: 0, snapshots: 0, dismissals: 0 })

      return { listId, run: () => restoreList(harness.db, USER, restore) }
    })
    expect(writes).toBeGreaterThanOrEqual(5)
  })
})
