import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The `lists.snapshot_fetched_at` migration (task 12.1) against data that
 * already exists. Every earlier migration is applied first, lists are inserted
 * the way they would already be on a real install, and only then is 0017
 * applied — so the backfill is tested on what it will actually meet.
 */
const DIRECTORY = fileURLToPath(new URL('../../drizzle', import.meta.url))

const files = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith('.sql'))
  .sort()

function apply(connection: Database.Database, name: string): void {
  const statements = readFileSync(`${DIRECTORY}/${name}`, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)

  for (const statement of statements) connection.exec(statement)
}

const migrationFile = files.find((name) => name.startsWith('0017_'))

describe('0017 snapshot_fetched_at migration', () => {
  let connection: Database.Database

  beforeEach(() => {
    connection = new Database(':memory:')
    connection.pragma('foreign_keys = ON')
    for (const name of files.filter((entry) => entry < '0017')) apply(connection, name)

    connection.exec(`INSERT INTO users (id, is_default_local_user, created_at) VALUES ('u1', 1, 0)`)
  })

  afterEach(() => connection.close())

  function insertList(id: string, source: string, createdAt: number, arrivedTitle: string | null) {
    connection
      .prepare(
        `INSERT INTO lists (id, user_id, title, media_type, source, arrived_title, created_at, updated_at)
         VALUES (?, 'u1', ?, 'youtube', ?, ?, ?, ?)`,
      )
      .run(id, id, source, arrivedTitle, createdAt, createdAt)
  }

  function insertSnapshotRow(listId: string) {
    connection
      .prepare(
        `INSERT INTO list_snapshots (id, list_id, title, order_index, time_to_consume_minutes)
         VALUES (?, ?, 'an item', 0, 20)`,
      )
      .run(`${listId}-row`, listId)
  }

  const fetchedAtOf = (listId: string) =>
    (
      connection.prepare(`SELECT snapshot_fetched_at AS at FROM lists WHERE id = ?`).get(listId) as {
        at: number | null
      }
    ).at

  it('exists as a migration file', () => {
    expect(migrationFile).toBeDefined()
  })

  it('dates a list that holds a source copy from when the list was created', () => {
    insertList('fetched', 'api', 1_700_000_000_000, 'Dungeon Soup')
    insertSnapshotRow('fetched')

    apply(connection, migrationFile!)

    expect(fetchedAtOf('fetched')).toBe(1_700_000_000_000)
  })

  it('dates a copy whose item rows are missing but whose arrived title is stored', () => {
    insertList('titled', 'api', 1_700_000_000_000, 'Dungeon Soup')

    apply(connection, migrationFile!)

    expect(fetchedAtOf('titled')).toBe(1_700_000_000_000)
  })

  it('leaves a list with no source copy undated, since there is nothing to age', () => {
    insertList('manual', 'manual', 1_700_000_000_000, null)
    insertList('canonical', 'canonical', 1_700_000_000_000, null)

    apply(connection, migrationFile!)

    expect(fetchedAtOf('manual')).toBeNull()
    expect(fetchedAtOf('canonical')).toBeNull()
  })
})
