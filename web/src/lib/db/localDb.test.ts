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

// Phase 53, 53.4: a migration and its tag are ONE call of the native `sql_batch`. A process killed at the call that is number `at`
// (counted from 1; 0 means no crash) dies before it runs (`before`), in the middle of it (`inside`: some statements have run and the
// transaction is rolled back, as SQLite does for a process that ends) or after it committed and before the page heard (`after`).
// `sent` keeps what every call carried.
const batch = {
  at: 0,
  mode: 'after' as 'before' | 'inside' | 'after',
  count: 0,
  sent: [] as { statements: { query: string; values?: unknown[] }[]; foreignKeysOff?: boolean }[],
  died: { executedBeforeDeath: -1 },
}

const fakeConnection = {
  execute: async (sql: string, params: unknown[] = []) => {
    await yieldToOthers()
    hookAllows.check?.('execute', sql, params)
    sqlite.prepare(positional(sql)).run(...params)
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

vi.mock('@tauri-apps/api/core', async () => {
  const { nativeSqlBatch } = await import('./sqlBatch.testing.js')

  return {
    invoke: async (command: string, args: unknown) => {
      if (command !== 'sql_batch') throw new Error(`invoke(${command}) is not available in this test`)
      const call = args as (typeof batch.sent)[number]
      batch.sent.push(call)
      batch.count += 1
      const dying = batch.at === batch.count
      if (dying && batch.mode === 'before') throw new Error('simulated crash')
      const inside = dying && batch.mode === 'inside' ? { dieAfterStatements: Math.max(1, Math.floor(call.statements.length / 2)), stats: batch.died } : {}
      const result = await nativeSqlBatch(sqlite, inside)(args)
      if (dying && batch.mode === 'after') throw new Error('simulated crash')

      return result
    },
  }
})

async function freshModule() {
  vi.resetModules()
  return await import('./localDb.js')
}

describe('createLocalDb', () => {
  beforeEach(async () => {
    sqlite = new BetterSqlite3(':memory:')
    loads = 0
    Object.assign(batch, { at: 0, mode: 'after', count: 0, sent: [], died: { executedBeforeDeath: -1 } })
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
   * Phase 53, task 53.4: a migration file and its tag row are ONE call of `sql_batch`, so a process that dies in the middle of one leaves
   * the schema as it was and the tag absent, and the next start runs the file again from its first statement. Before, a file was applied
   * statement by statement with progress rows (BL-082: a half-changed schema failed for ever with "duplicate column name"). Every call the
   * process can die at is tried, before it runs, in the middle of it and after it committed, on an install that has data.
   */
  describe('an upgrade cut short by a crash (BL-082, atomic since 53.4)', () => {
    const dir = join(import.meta.dirname, '../../../../server/drizzle')
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
    const tagOf = (file: string) => file.replace(/\.sql$/, '')
    const statementsOf = (file: string) =>
      readFileSync(join(dir, file), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)

    /** An install of an older version: the migrations before `firstPending` applied and recorded, with a list of grouped items. */
    function oldInstall(firstPending: string): void {
      sqlite.exec('CREATE TABLE IF NOT EXISTS __local_migrations (tag text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)')
      for (const file of files) {
        const tag = tagOf(file)
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

    /** The part of the state that exists in every version: for comparing a database with itself before and after a start that failed. */
    function shape() {
      return {
        schema: sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),
        tags: sqlite.prepare('SELECT tag FROM __local_migrations ORDER BY tag').all(),
        lists: sqlite.prepare('SELECT id, title FROM lists ORDER BY id').all(),
        items: sqlite.prepare('SELECT id, title, "group" FROM list_items ORDER BY id').all(),
      }
    }

    const newDatabase = () => {
      sqlite.close()
      sqlite = new BetterSqlite3(':memory:')
    }

    /** Upgrades a fresh old install; with `at`, the process dies at that call and the app is started again. */
    async function upgrade(firstPending: string, at = 0, mode: 'before' | 'inside' | 'after' = 'after') {
      newDatabase()
      oldInstall(firstPending)
      Object.assign(batch, { at, mode, count: 0, sent: [] })

      if (at === 0) {
        await (await freshModule()).createLocalDb()
      } else {
        await expect((await freshModule()).createLocalDb()).rejects.toThrow('simulated crash')
        batch.at = 0
        await (await freshModule()).createLocalDb()
      }

      return { calls: batch.count, state: snapshot() }
    }

    it('sends each migration and its tag row as ONE call, in order', async () => {
      newDatabase()
      await (await freshModule()).createLocalDb()

      expect(batch.sent).toHaveLength(files.length)
      for (const [index, file] of files.entries()) {
        const { statements, foreignKeysOff } = batch.sent[index]!
        const tag = tagOf(file)
        expect(statements.slice(0, -1).map((statement) => statement.query), tag).toEqual(statementsOf(file))
        expect(statements.at(-1)?.query, tag).toBe('INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)')
        expect(statements.at(-1)?.values?.[0], tag).toBe(tag)
        expect(foreignKeysOff, `${tag}: only a rebuild runs with enforcement off`).toBeUndefined()
      }
    })

    it.each(['before', 'inside', 'after'] as const)(
      'starts again and ends where a clean upgrade ends, whichever call the process dies at (%s the call ran)',
      async (mode) => {
        const reference = await upgrade('0011')
        expect(reference.calls).toBeGreaterThan(5)
        expect(reference.state.groups.length).toBeGreaterThan(0)
        expect(reference.state.tags.some((tag) => tag.includes('#'))).toBe(false)

        for (let at = 1; at <= reference.calls; at += 1) {
          const { state } = await upgrade('0011', at, mode)
          expect({ at, ...state }).toEqual({ at, ...reference.state })
        }
      },
      120_000,
    )

    it('a process that dies in the middle of a migration leaves the schema as it was and its tag absent', async () => {
      newDatabase()
      oldInstall('0011')
      const before = shape()
      Object.assign(batch, { at: 1, mode: 'inside', count: 0, sent: [] })

      await expect((await freshModule()).createLocalDb()).rejects.toThrow('simulated crash')

      expect(batch.died.executedBeforeDeath, 'it died AFTER some statements had run').toBeGreaterThan(0)
      expect(shape()).toEqual(before)
      expect((shape().tags as { tag: string }[]).some(({ tag }) => tag.startsWith('0011'))).toBe(false)
    })

    it('leaves nothing of its bookkeeping behind once the upgrade is done', async () => {
      const { tags } = (await upgrade('0017')).state

      expect(tags.filter((tag) => tag.includes('#'))).toEqual([])
      expect(new Set(tags).size).toBe(tags.length)
    })

    it('fails, and changes nothing, when a first attempt meets what it should not', async () => {
      newDatabase()
      oldInstall('0017')
      sqlite.exec('ALTER TABLE lists ADD snapshot_fetched_at integer')
      const before = shape()

      await expect((await freshModule()).createLocalDb()).rejects.toThrow(/duplicate column name/)

      expect(shape()).toEqual(before)
    })

    /**
     * What a build from before 53.4 leaves when it is killed in the middle of a migration: the first `done` statements applied with a
     * progress row each (`<tag>#start`, `<tag>#0`, ...), and perhaps the next one applied without its row. The new runner finishes it with
     * the old resume code, which stays for this release.
     */
    describe('a migration an older build left half done (its progress rows are there)', () => {
      // The first file from 0011 on with several statements, so there are places to stop at.
      const file = files.find((name) => name >= '0011' && statementsOf(name).length >= 3)!
      const tag = tagOf(file)

      function leaveHalfDone(done: number, nextApplied: boolean): void {
        newDatabase()
        oldInstall(tag)
        const statements = statementsOf(file)
        sqlite.prepare('INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)').run(`${tag}#start`, 1)
        for (let index = 0; index < done; index += 1) {
          sqlite.exec(statements[index]!)
          sqlite.prepare('INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)').run(`${tag}#${index}`, 1)
        }
        if (nextApplied) sqlite.exec(statements[done]!)
      }

      it.each([false, true])('is finished from where it stopped, wherever that was (the next statement had run: %s)', async (nextApplied) => {
        const reference = (await upgrade(tag)).state
        const total = statementsOf(file).length
        expect(total).toBeGreaterThanOrEqual(3)

        for (let done = 0; done < total; done += 1) {
          leaveHalfDone(done, nextApplied)
          Object.assign(batch, { at: 0, count: 0, sent: [] })

          await (await freshModule()).createLocalDb()

          expect({ done, ...snapshot() }).toEqual({ done, ...reference })
        }
      })

      it('lets only the one statement that may have run without its record answer "already done"', async () => {
        // A state no crash can make: the cut-short upgrade of 0012 finds BOTH of its columns there with no progress rows.
        newDatabase()
        oldInstall('0012')
        sqlite.exec('ALTER TABLE lists ADD description text')
        sqlite.exec('ALTER TABLE lists ADD status text')
        const old = tagOf(files.find((name) => name.startsWith('0012'))!)
        sqlite.prepare('INSERT INTO __local_migrations (tag, applied_at) VALUES (?, ?)').run(`${old}#start`, 1)

        await expect((await freshModule()).createLocalDb()).rejects.toThrow(/duplicate column name/)
      })
    })

    /**
     * drizzle-kit writes a table rebuild as `PRAGMA foreign_keys=OFF; ... DROP TABLE; RENAME TO ...; PRAGMA foreign_keys=ON;` in one file.
     * The hook refuses the OFF, and inside a transaction the pragma does nothing anyway: the runner takes the two lines out and asks the
     * native command for enforcement off on its own connection. No such migration exists yet (`migrationRebuild.guard.test.ts` keeps it so).
     */
    describe('a migration that rebuilds a table', () => {
      const rebuild = [
        'PRAGMA foreign_keys=OFF;',
        'CREATE TABLE `__new_parents` (`id` text PRIMARY KEY NOT NULL, `title` text NOT NULL, `extra` text);',
        'INSERT INTO `__new_parents`(`id`, `title`) SELECT `id`, `title` FROM `parents`;',
        'DROP TABLE `parents`;',
        'ALTER TABLE `__new_parents` RENAME TO `parents`;',
        'PRAGMA foreign_keys=ON;',
      ].join('\n--> statement-breakpoint\n')

      function withChildren(): void {
        newDatabase()
        sqlite.pragma('foreign_keys = ON')
        sqlite.exec(`
          CREATE TABLE parents (id text PRIMARY KEY NOT NULL, title text NOT NULL);
          CREATE TABLE children (id text PRIMARY KEY NOT NULL, parent_id text NOT NULL REFERENCES parents(id) ON DELETE CASCADE);
          INSERT INTO parents VALUES ('p1', 'One'), ('p2', 'Two');
          INSERT INTO children VALUES ('c1', 'p1'), ('c2', 'p1'), ('c3', 'p2');
        `)
      }

      const run = async (sql: string) => {
        const { runLocalMigrations } = await freshModule()
        const connection = await (await import('@tauri-apps/plugin-sql')).default.load('sqlite:listulator.sqlite')

        return await runLocalMigrations(connection, [{ tag: '9000_rebuild', sql }])
      }
      const children = () => (sqlite.prepare('SELECT count(*) AS n FROM children').get() as { n: number }).n
      const parentColumns = () => (sqlite.prepare('PRAGMA table_info(parents)').all() as { name: string }[]).map((column) => column.name)
      const enforcing = () => sqlite.pragma('foreign_keys', { simple: true })

      it('keeps the children, records the tag, sends no pragma and leaves enforcement on', async () => {
        withChildren()

        await run(rebuild)

        expect(children()).toBe(3)
        expect(parentColumns()).toEqual(['id', 'title', 'extra'])
        expect(sqlite.prepare('SELECT tag FROM __local_migrations').all()).toEqual([{ tag: '9000_rebuild' }])
        expect(batch.sent).toHaveLength(1)
        expect(batch.sent[0]?.foreignKeysOff).toBe(true)
        expect(batch.sent[0]?.statements.map((statement) => statement.query).filter((query) => /pragma/i.test(query))).toEqual([])
        expect(enforcing()).toBe(1)
      })

      it('undoes the whole rebuild when a statement fails: the old table, its children, no tag', async () => {
        withChildren()

        await expect(run(rebuild.replace('ALTER TABLE `__new_parents` RENAME TO `parents`;', 'ALTER TABLE `nope` RENAME TO `parents`;'))).rejects.toThrow(/nope/)

        expect(parentColumns()).toEqual(['id', 'title'])
        expect(children()).toBe(3)
        expect(sqlite.prepare('SELECT tag FROM __local_migrations').all()).toEqual([])
        expect(enforcing()).toBe(1)
      })

      it('refuses to commit a rebuild that leaves a child with no parent', async () => {
        withChildren()
        const forgetful = rebuild.replace('INSERT INTO `__new_parents`(`id`, `title`) SELECT `id`, `title` FROM `parents`;', 'SELECT 1;')

        await expect(run(forgetful)).rejects.toThrow(/foreign key check failed/)

        expect(parentColumns()).toEqual(['id', 'title'])
        expect(children()).toBe(3)
        expect(enforcing()).toBe(1)
      })
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
