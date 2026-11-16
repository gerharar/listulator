import BetterSqlite3 from 'better-sqlite3'
import { count, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAtomically, type AtomicBatchError } from '../../../../server/src/db/atomic.js'
import { createDatabase, runMigrations, type PortableDatabase } from '../../../../server/src/db/client.js'
import { lists, users } from '../../../../server/src/db/schema.js'
import { nativeSqlBatch } from './sqlBatch.testing.js'

/**
 * Task 53.3: the portable helper that runs a list of statements in one transaction (`server/src/db/atomic.ts`), proved on BOTH drivers the
 * shared code runs on, by one set of cases:
 *   - the server's: better-sqlite3 under Drizzle, synchronous, one native transaction with no `await` inside it;
 *   - the desktop's: the sqlite-proxy driver, whose `db.batch` sends the whole list to the native `sql_batch` (`localDb.ts`). The native
 *     command is replaced by a real in-memory SQLite that runs the list in a transaction, after the isolation hook has looked at it
 *     (`sqlBatchThroughHook`), so a value the hook would refuse fails here. The command itself is proved by `cargo test` (`sql_batch.rs`).
 */
let desktopSqlite: BetterSqlite3.Database
const native = vi.hoisted(() => ({ run: undefined as undefined | ((args: unknown) => Promise<unknown>), calls: 0, pluginCalls: 0 }))

// The plugin's one-statement commands, as the perf test makes them: a real SQLite, every statement through the hook first.
const positional = (query: string) => query.replace(/\$\d+/g, '?')

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { sqlThroughHook: checkedStatement } = await import('../isolationHook.testing.js')
  const checked = checkedStatement()

  return {
    default: {
      load: vi.fn(async () => ({
        execute: async (query: string, params: unknown[] = []) => {
          native.pluginCalls += 1
          checked('execute', query, params)
          desktopSqlite.prepare(positional(query)).run(...params)
        },
        select: async (query: string, params: unknown[] = []) => {
          native.pluginCalls += 1
          checked('select', query, params)
          return desktopSqlite.prepare(positional(query)).all(...params)
        },
      })),
    },
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args: unknown) => {
    if (command !== 'sql_batch') throw new Error(`unexpected command ${command}`)
    native.calls += 1

    return await native.run!(args)
  }),
}))

interface Driver {
  name: string
  open: () => Promise<PortableDatabase>
}

const server: Driver = {
  name: 'the server (better-sqlite3, one synchronous transaction)',
  open: async () => {
    const { db } = createDatabase(':memory:')
    runMigrations(db)

    return db
  },
}

const desktop: Driver = {
  name: 'the desktop (sqlite-proxy, one sql_batch call)',
  open: async () => {
    desktopSqlite = new BetterSqlite3(':memory:')
    native.run = nativeSqlBatch(desktopSqlite)
    vi.resetModules()
    const { createLocalDb } = await import('./localDb.js')
    const db = await createLocalDb()
    // Opening ran the migrations through the same command: what is counted is what the test does.
    native.calls = 0

    return db
  },
}

const AT = new Date(1_700_000_000_000)

/** A user, two lists, a read that must see them, and a rename that gives its row back: every kind of statement the rewrites hold. */
const rewrite = (db: PortableDatabase) =>
  [
    db.insert(users).values({ id: 'u1', isDefaultLocalUser: true, createdAt: AT }).returning({ id: users.id, isDefault: users.isDefaultLocalUser, createdAt: users.createdAt }),
    db.insert(lists).values({ id: 'l1', userId: 'u1', title: 'One', mediaType: 'movie', createdAt: AT, updatedAt: AT }),
    db.insert(lists).values({ id: 'l2', userId: 'u1', title: 'Two', mediaType: 'book', createdAt: AT, updatedAt: AT }),
    db.select({ n: count() }).from(lists),
    db.update(lists).set({ title: 'Renamed' }).where(eq(lists.id, 'l1')).returning({ id: lists.id, title: lists.title }),
  ] as const

async function counts(db: PortableDatabase) {
  const [people] = await db.select({ n: count() }).from(users)
  const [shelves] = await db.select({ n: count() }).from(lists)

  return { users: people?.n, lists: shelves?.n }
}

beforeEach(() => {
  native.calls = 0
})
afterEach(() => {
  desktopSqlite?.close()
})

describe.each([server, desktop])('runAtomically on $name', ({ open }) => {
  it('runs the list in order, gives the rows of the statements that return them and nothing for the others', async () => {
    const db = await open()

    const results = await runAtomically(db, rewrite(db))

    expect(results).toEqual([
      [{ id: 'u1', isDefault: true, createdAt: AT }],
      undefined,
      undefined,
      [{ n: 2 }],
      [{ id: 'l1', title: 'Renamed' }],
    ])
    expect(await counts(db)).toEqual({ users: 1, lists: 2 })
  })

  it('leaves no row behind when a statement in the middle fails, and says which one', async () => {
    const db = await open()

    const failing = [
      db.insert(users).values({ id: 'u1', isDefaultLocalUser: true, createdAt: AT }).returning({ id: users.id }),
      db.insert(lists).values({ id: 'l1', userId: 'u1', title: 'One', mediaType: 'movie', createdAt: AT, updatedAt: AT }),
      // the same primary key again: refused by the database, after two statements went through
      db.insert(lists).values({ id: 'l1', userId: 'u1', title: 'Again', mediaType: 'movie', createdAt: AT, updatedAt: AT }),
      db.insert(lists).values({ id: 'l3', userId: 'u1', title: 'Never', mediaType: 'movie', createdAt: AT, updatedAt: AT }),
    ] as const

    const error = await runAtomically(db, failing).catch((cause: unknown) => cause)

    // By name: the desktop's driver is loaded fresh for each test, so its error class is not this file's.
    expect((error as Error).name).toBe('AtomicBatchError')
    expect((error as AtomicBatchError).statement).toBe(2)
    expect((error as AtomicBatchError).message).toMatch(/statement 2.*UNIQUE/i)
    expect(await counts(db)).toEqual({ users: 0, lists: 0 })
  })

  it('works again after a failure: nothing is left open, nothing waits for a lock', async () => {
    const db = await open()
    await expect(runAtomically(db, [db.insert(lists).values({ id: 'x', userId: 'nobody', title: 'T', mediaType: 'm', createdAt: AT, updatedAt: AT })])).rejects.toThrow()

    const started = Date.now()
    await runAtomically(db, rewrite(db))

    expect(Date.now() - started).toBeLessThan(1000)
    expect(await counts(db)).toEqual({ users: 1, lists: 2 })
  })

  it('lets a statement read what an earlier statement of the same call wrote', async () => {
    const db = await open()

    const [, , seen] = await runAtomically(db, [
      db.insert(users).values({ id: 'u1', isDefaultLocalUser: false, createdAt: AT }),
      db.insert(lists).values({ id: 'l1', userId: 'u1', title: 'One', mediaType: 'movie', createdAt: AT, updatedAt: AT }),
      db.select({ title: lists.title }).from(lists).where(eq(lists.userId, 'u1')),
    ] as const)

    expect(seen).toEqual([{ title: 'One' }])
  })

  it('does nothing, and asks nothing of the database, for an empty list', async () => {
    const db = await open()

    expect(await runAtomically(db, [])).toEqual([])
    expect(native.calls).toBe(0)
  })

  it('carries a statement written with the sql template, with its values bound', async () => {
    const db = await open()

    const [, rows] = await runAtomically(db, [
      db.insert(users).values({ id: 'u1', isDefaultLocalUser: false, createdAt: AT }),
      db.select({ id: users.id, shout: sql<string>`upper(${users.id}) || ${'!'}` }).from(users),
    ] as const)

    expect(rows).toEqual([{ id: 'u1', shout: 'U1!' }])
  })
})

describe('a failure outside the statements', () => {
  it('is an AtomicBatchError too: a busy file or a commit that fails never reaches the caller as a bare driver error', async () => {
    // better-sqlite3 runs BEGIN and COMMIT outside the function it is given: this is the database refusing at either of them.
    const busy = { transaction: () => { throw new Error('database is locked') } } as unknown as PortableDatabase

    const error = await runAtomically(busy, [{} as never]).catch((cause: unknown) => cause)

    expect((error as Error).name).toBe('AtomicBatchError')
    expect((error as AtomicBatchError).statement).toBeUndefined()
    expect((error as Error).message).toMatch(/database is locked/)
  })
})

describe('the isolation hook sees every batch the desktop sends', () => {
  it('refuses a value of a kind the app never sends, here a Date that a raw sql template interpolated', async () => {
    const db = await desktop.open()

    const error = await runAtomically(db, [db.insert(users).values({ id: 'u1', isDefaultLocalUser: false, createdAt: sql`${new Date(0)}` })]).catch((cause: unknown) => cause)

    expect((error as Error).message).toMatch(/isolation hook refused a batch/)
    expect(await counts(db)).toEqual({ users: 0, lists: 0 })
  })
})

describe('the two drivers', () => {
  it('give the same values for the same list', async () => {
    const onServer = await server.open()
    const serverResults = await runAtomically(onServer, rewrite(onServer))
    const onDesktop = await desktop.open()
    const desktopResults = await runAtomically(onDesktop, rewrite(onDesktop))

    expect(desktopResults).toEqual(serverResults)
    expect(native.calls).toBe(1)
  })

  it('send a list to the desktop in ONE call, however long it is', async () => {
    const db = await desktop.open()
    const many = Array.from({ length: 300 }, (_, n) => db.insert(users).values({ id: `u${n}`, isDefaultLocalUser: false, createdAt: AT }))

    await runAtomically(db, many)

    expect(native.calls).toBe(1)
    expect((await counts(db)).users).toBe(300)
  })

  it('send nothing through the plugin\u2019s one-statement commands while the list runs (each would be a commit of its own)', async () => {
    const db = await desktop.open()
    const before = native.pluginCalls

    await runAtomically(db, rewrite(db))

    expect(native.pluginCalls).toBe(before)
    expect(native.calls).toBe(1)
  })
})
