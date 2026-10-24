import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The `lists.is_sample` migration (H-018, task 33.7) against data that already exists. Every earlier migration is applied first, lists are
 * inserted the way they are on a real install, and only then is the new one applied: no list that is there becomes a sample.
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

const migration = files.find((name) => name.includes('list_is_sample'))

describe('the is_sample migration', () => {
  let connection: Database.Database

  beforeEach(() => {
    connection = new Database(':memory:')
    connection.pragma('foreign_keys = ON')
    expect(migration, 'a migration named *list_is_sample* exists').toBeDefined()
    for (const name of files.filter((entry) => entry < migration!)) apply(connection, name)
    connection.exec(`INSERT INTO users (id, is_default_local_user, created_at) VALUES ('u1', 1, 0)`)
    connection.exec(
      `INSERT INTO lists (id, user_id, title, media_type, source, created_at, updated_at) VALUES ('old-1', 'u1', 'An old list', 'tv', 'manual', 1, 1), ('old-2', 'u1', 'Another', 'movie', 'canonical', 2, 2)`,
    )
  })

  afterEach(() => connection.close())

  const sampleOf = (id: string) => (connection.prepare(`SELECT is_sample AS flag FROM lists WHERE id = ?`).get(id) as { flag: number }).flag

  it('is the next migration after the item notes one, and the only change', () => {
    expect(files.indexOf(migration!)).toBe(files.indexOf('0021_item_user_note.sql') + 1)
    expect(readFileSync(`${DIRECTORY}/${migration}`, 'utf8').trim()).toBe('ALTER TABLE `lists` ADD `is_sample` integer DEFAULT false NOT NULL;')
  })

  it('leaves every list that is already there as it was: not a sample', () => {
    apply(connection, migration!)

    expect(sampleOf('old-1')).toBe(0)
    expect(sampleOf('old-2')).toBe(0)
    expect(connection.prepare(`SELECT COUNT(*) AS n FROM lists`).get()).toEqual({ n: 2 })
  })

  it('gives a list made afterwards no mark unless it is given one, and the mark can be set and cleared', () => {
    apply(connection, migration!)
    connection.exec(`INSERT INTO lists (id, user_id, title, media_type, source, created_at, updated_at) VALUES ('new-1', 'u1', 'New', 'tv', 'manual', 3, 3)`)
    expect(sampleOf('new-1')).toBe(0)

    connection.exec(`UPDATE lists SET is_sample = 1 WHERE id = 'new-1'`)
    expect(sampleOf('new-1')).toBe(1)
    connection.exec(`UPDATE lists SET is_sample = 0 WHERE id = 'new-1'`)
    expect(sampleOf('new-1')).toBe(0)
  })

  it('never lets the mark be empty', () => {
    apply(connection, migration!)

    expect(() => connection.exec(`UPDATE lists SET is_sample = NULL WHERE id = 'old-1'`)).toThrow()
  })
})
