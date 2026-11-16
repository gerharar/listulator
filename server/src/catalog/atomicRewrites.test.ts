import type BetterSqlite3 from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../db/client.js'
import { dismissedItems, listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems } from './bulkItems.js'
import { resetToSource } from './reset.js'
import { createList as createStoredList } from './repository.js'
import { restoreItemSet } from './restore.js'

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
