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

const fakeConnection = {
  execute: async (sql: string, params: unknown[] = []) => {
    await yieldToOthers()
    sqlite.prepare(positional(sql)).run(...params)
  },
  select: async (sql: string, params: unknown[] = []) => {
    await yieldToOthers()
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
  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:')
    loads = 0
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
})
