import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * BL-032: at start-up several API calls ask for the database at once. The first
 * launch after a migration is where that used to show: each caller ran the
 * pending migrations, and the second one's `ALTER TABLE ... ADD` failed, so
 * "Couldn't load your lists". The plugin is replaced by a real in-memory SQLite
 * that yields between calls, so the callers genuinely interleave, and the real
 * migration files run.
 */
let sqlite: BetterSqlite3.Database
let loads = 0

const yieldToOthers = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// The plugin numbers its parameters `$1, $2`, in order; better-sqlite3 binds plain `?`.
const positional = (sql: string) => sql.replace(/\$\d+/g, '?')

// Every statement goes through the desktop's isolation hook first, as in the built app (19.12.3).
const hookAllows = vi.hoisted(() => ({ check: undefined as undefined | ((command: 'select' | 'execute', query: string, values: unknown[]) => void) }))

// BL-082: a process killed between two calls. `at` is the number of the `execute` call that dies, counted from 1; the
// statement either never ran (`before`) or ran and its caller never heard (`after`). 0 means no crash.
const crash = { at: 0, mode: 'after' as 'before' | 'after', count: 0 }

const fakeConnection = {
  execute: async (sql: string, params: unknown[] = []) => {
    await yieldToOthers()
    hookAllows.check?.('execute', sql, params)
    crash.count += 1
    if (crash.at === crash.count && crash.mode === 'before') throw new Error('simulated crash')
    sqlite.prepare(positional(sql)).run(...params)
    if (crash.at === crash.count && crash.mode === 'after') throw new Error('simulated crash')
  },
  select: async (sql: string, params: unknown[] = []) => {
    await yieldToOthers()
    hookAllows.check?.('select', sql, params)
    return sqlite.prepare(positional(sql)).all(...params)
  },
}

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => {
      loads += 1
      await yieldToOthers()
      return fakeConnection
    }),
  },
}))

async function freshModule() {
  vi.resetModules()
  return await import('./localDb.js')
}

describe('createLocalDb', () => {
  beforeEach(async () => {
    sqlite = new BetterSqlite3(':memory:')
    loads = 0
    Object.assign(crash, { at: 0, mode: 'after', count: 0 })
    hookAllows.check = (await import('../isolationHook.testing.js')).sqlThroughHook()
  })

  afterEach(() => sqlite.close())

  const migrationsRecorded = () =>
    (sqlite.prepare('SELECT tag FROM __local_migrations').all() as { tag: string }[]).map((row) => row.tag)

  it('migrates a fresh database once when several callers ask for it at the same time', async () => {
    const { createLocalDb } = await freshModule()

    const [first, second, third] = await Promise.all([createLocalDb(), createLocalDb(), createLocalDb()])

    expect(first).toBe(second)
    expect(second).toBe(third)
    expect(loads).toBe(1)
    const tags = migrationsRecorded()
    expect(tags.length).toBeGreaterThan(10)
    expect(new Set(tags).size).toBe(tags.length)
  })

  it('applies only the migrations a database is missing, even with callers racing', async () => {
    const first = await freshModule()
    await first.createLocalDb()
    // An install from before the last migration: its column and its record are gone.
    sqlite.exec('ALTER TABLE lists DROP COLUMN snapshot_fetched_at')
    sqlite.exec(`DELETE FROM __local_migrations WHERE tag LIKE '0017%'`)
    const { createLocalDb } = await freshModule()

    await Promise.all([createLocalDb(), createLocalDb()])

    expect(migrationsRecorded().filter((tag) => tag.startsWith('0017'))).toHaveLength(1)
    const columns = sqlite.prepare('PRAGMA table_info(lists)').all() as { name: string }[]
    expect(columns.map((column) => column.name)).toContain('snapshot_fetched_at')
  })

  it('can be tried again after a failed opening, rather than remembering the failure', async () => {
    const { createLocalDb } = await freshModule()
    const plugin = (await import('@tauri-apps/plugin-sql')).default
    vi.mocked(plugin.load).mockRejectedValueOnce(new Error('database is locked'))

    await expect(createLocalDb()).rejects.toThrow('database is locked')

    await expect(createLocalDb()).resolves.toBeDefined()
  })

  /**
   * BL-082: a migration file is applied statement by statement (a transaction is not available: the hook refuses `BEGIN` and
   * a second statement, and the plugin's pool may give each call another connection), and its tag is recorded last. A kill
   * in between left the schema half changed with the tag missing, so every start ran the same statements again and failed
   * ("duplicate column name") for ever. Every point at which the process can die is tried, on an install that has data.
   */
  describe('an upgrade cut short by a crash (BL-082)', () => {
    const dir = join(import.meta.dirname, '../../../../server/drizzle')
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    const statementsOf = (file: string) =>
      readFileSync(join(dir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)

    /** An install of an older version: the migrations before `firstPending` applied and recorded, with a list of grouped items. */
    function oldInstall(firstPending: string): void {
      sqlite.exec('CREATE TABLE IF NOT EXISTS __local_migrations (tag text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)')
      for (const file of files) {
        const tag = file.replace(/\.sql$/, '')
        if (tag >= firstPending) break
        for (const statement of statementsOf(file)) sqlite.exec(statement)
        sqlite.prepare('INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)').run(tag, 1)
      }
      sqlite.exec(`INSERT INTO users (id, is_default_local_user, created_at) VALUES ('u1', 1, 1)`)
      sqlite.exec(`INSERT INTO lists (id, user_id, title, media_type, created_at, updated_at) VALUES ('l1', 'u1', 'A', 'movie', 5, 5), ('l2', 'u1', 'B', 'movie', 6, 6)`)
      sqlite.exec(`INSERT INTO list_items (id, list_id, title, order_index, time_to_consume_minutes, created_at, updated_at, "group") VALUES
        ('a1', 'l1', 'one', 0, 10, 1, 1, 'X'), ('a2', 'l1', 'two', 1, 10, 1, 1, 'Y'), ('a3', 'l1', 'three', 2, 10, 1, 1, 'X'), ('b1', 'l2', 'four', 0, 10, 1, 1, 'Z')`)
    }

    /** What an upgrade leaves behind, without the parts that are random by design (the ids and times of the backfilled groups). */
    function snapshot() {
      return {
        schema: sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),
        tags: (sqlite.prepare('SELECT tag FROM __local_migrations ORDER BY tag').all() as { tag: string }[]).map((row) => row.tag),
        groups: sqlite.prepare('SELECT list_id, name, order_index FROM list_groups ORDER BY list_id, order_index').all(),
        lists: sqlite.prepare('SELECT id, snapshot_fetched_at FROM lists ORDER BY id').all(),
        items: sqlite.prepare('SELECT id, title, "group" FROM list_items ORDER BY id').all(),
      }
    }

    /** Upgrades a fresh old install; with `at`, the process dies at that `execute` call and the app is started again. */
    async function upgrade(firstPending: string, at = 0, mode: 'before' | 'after' = 'after') {
      sqlite.close()
      sqlite = new BetterSqlite3(':memory:')
      oldInstall(firstPending)
      Object.assign(crash, { at, mode, count: 0 })

      if (at === 0) {
        await (await freshModule()).createLocalDb()
      } else {
        await expect((await freshModule()).createLocalDb()).rejects.toThrow('simulated crash')
        crash.at = 0
        await (await freshModule()).createLocalDb()
      }

      return { executed: crash.count, state: snapshot() }
    }

    it.each(['before', 'after'] as const)(
      'starts again and ends where a clean upgrade ends, whichever call the process dies at (%s the statement ran)',
      async (mode) => {
        const reference = await upgrade('0011')
        expect(reference.executed).toBeGreaterThan(25)
        expect(reference.state.groups.length).toBeGreaterThan(0)
        expect(reference.state.tags.some((tag) => tag.includes('#'))).toBe(false)

        for (let at = 1; at <= reference.executed; at += 1) {
          const { state } = await upgrade('0011', at, mode)
          expect({ at, ...state }).toEqual({ at, ...reference.state })
        }
      },
      120_000,
    )

    it('leaves nothing of its bookkeeping behind once the upgrade is done', async () => {
      const { tags } = (await upgrade('0017')).state

      expect(tags.filter((tag) => tag.includes('#'))).toEqual([])
      expect(new Set(tags).size).toBe(tags.length)
    })

    it('lets only the one statement that may have run without its record answer "already done"', async () => {
      // A state no crash can make: the cut-short upgrade of 0012 finds BOTH of its columns there with no progress rows.
      oldInstall('0012')
      sqlite.exec('ALTER TABLE lists ADD description text')
      sqlite.exec('ALTER TABLE lists ADD status text')
      const tag = files.find((file) => file.startsWith('0012'))!.replace(/\.sql$/, '')
      sqlite.prepare('INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)').run(`${tag}#start`, 1)

      await expect((await freshModule()).createLocalDb()).rejects.toThrow(/duplicate column name/)
    })

    it('still fails on a first attempt that meets what it should not: only a cut-short upgrade is retried leniently', async () => {
      sqlite.close()
      sqlite = new BetterSqlite3(':memory:')
      oldInstall('0017')
      sqlite.exec('ALTER TABLE lists ADD snapshot_fetched_at integer')

      await expect((await freshModule()).createLocalDb()).rejects.toThrow(/duplicate column name/)
    })
  })
})

describe('alreadyApplied: what a statement that has run answers when it is run again (BL-082)', () => {
  const check = async (statement: string, error: unknown) => (await freshModule()).alreadyApplied(statement, error)

  it.each([
    ['an added column', 'ALTER TABLE `lists` ADD `status` text;', 'duplicate column name: status'],
    ['a dropped column', 'ALTER TABLE `list_items` DROP COLUMN `language`;', 'no such column: "language"'],
    ['a table', 'CREATE TABLE `x` (`id` text);', 'table `x` already exists'],
    ['an index', 'CREATE INDEX `i` ON `x` (`id`);', 'index i already exists'],
    ['a unique index', 'CREATE UNIQUE INDEX `i` ON `x` (`id`);', 'index i already exists'],
    ['a dropped table', 'DROP TABLE `x`;', 'no such table: x'],
    ['a dropped index', 'DROP INDEX `i`;', 'no such index: i'],
    ['a backfill', 'INSERT INTO `x` (`id`) SELECT 1;', 'UNIQUE constraint failed: x.id'],
    ['a backfill that starts with comments', '-- Backfill (D3): one group per label.\n/* more */\nINSERT INTO `x` (`id`) SELECT 1;', 'UNIQUE constraint failed: x.id'],
    ['the plugin’s own wording', 'ALTER TABLE `lists` ADD `status` text;', 'error returned from database: (code: 1) duplicate column name: status'],
  ])('accepts %s', async (_name, statement, message) => {
    expect(await check(statement, new Error(message))).toBe(true)
    expect(await check(statement, message)).toBe(true)
  })

  it.each([
    ['an added column that fails for another reason', 'ALTER TABLE `lists` ADD `status` text;', 'no such table: lists'],
    ['an added column that answers with another statement’s wording', 'ALTER TABLE `lists` ADD `status` text;', 'table x already exists'],
    ['a dropped column that answers "duplicate column name"', 'ALTER TABLE `lists` DROP COLUMN `a`;', 'duplicate column name: a'],
    ['a table that fails with a syntax error', 'CREATE TABLE `x` (`id` text);', 'near ")": syntax error'],
    ['a dropped table that fails for another reason', 'DROP TABLE `x`;', 'database is locked'],
    ['an insert that fails a not-null check', 'INSERT INTO `x` (`id`) SELECT 1;', 'NOT NULL constraint failed: x.id'],
    ['an update with any answer', 'UPDATE `x` SET `a` = 1;', 'UNIQUE constraint failed: x.a'],
    ['a delete with any answer', 'DELETE FROM `x`;', 'no such table: x'],
    ['a select with any answer', 'SELECT 1;', 'already exists'],
    ['nothing at all', '', 'already exists'],
  ])('refuses %s', async (_name, statement, message) => {
    expect(await check(statement, new Error(message))).toBe(false)
  })
})
