import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The orphan cleanup migration (BL-137): rows whose list is gone are removed from the four tables that hold a `list_id`, and nothing else is.
 * Two desktop databases carried two list items of a list that no longer existed (found 2026-10-25 by `PRAGMA foreign_key_check`); no screen
 * can reach such a row, since every query starts from a list. Every earlier migration is applied first, and the orphans are made with foreign
 * keys off, as whatever made the real ones must have been.
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

const migration = files.find((name) => name.includes('orphan_list_children'))

describe('the orphan cleanup migration', () => {
  let connection: Database.Database

  beforeEach(() => {
    connection = new Database(':memory:')
    expect(migration, 'a migration named *orphan_list_children* exists').toBeDefined()
    for (const name of files.filter((entry) => entry < migration!)) apply(connection, name)

    connection.pragma('foreign_keys = OFF')
    connection.exec(`INSERT INTO users (id, is_default_local_user, created_at) VALUES ('u1', 1, 0)`)
    connection.exec(`INSERT INTO lists (id, user_id, title, media_type, source, created_at, updated_at) VALUES ('live', 'u1', 'Kept', 'tv', 'manual', 1, 1)`)
    const item = (id: string, listId: string) =>
      connection.prepare(`INSERT INTO list_items (id, list_id, title, order_index, time_to_consume_minutes, created_at, updated_at) VALUES (?, ?, ?, 0, 30, 1, 1)`).run(id, listId, id)
    item('live-item', 'live')
    item('gone-item-1', 'gone')
    item('gone-item-2', 'gone')
    connection.exec(`INSERT INTO list_groups (id, list_id, name, order_index, created_at, updated_at) VALUES ('live-group', 'live', 'Season 1', 0, 1, 1), ('gone-group', 'gone', 'Season 1', 0, 1, 1)`)
    connection.exec(`INSERT INTO list_snapshots (id, list_id, title, order_index, time_to_consume_minutes) VALUES ('live-snap', 'live', 'x', 0, 20), ('gone-snap', 'gone', 'x', 0, 20)`)
    connection.exec(`INSERT INTO dismissed_items (id, list_id, title_key, created_at) VALUES ('live-dismissed', 'live', 'key-1', 1), ('gone-dismissed', 'gone', 'key-2', 1)`)
  })

  afterEach(() => connection.close())

  const ids = (table: string) => (connection.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map((row) => row.id)

  it('is the next migration after the sample mark, and only deletes', () => {
    expect(files.indexOf(migration!)).toBe(files.findIndex((name) => name.includes('list_is_sample')) + 1)
    const sql = readFileSync(`${DIRECTORY}/${migration}`, 'utf8')
    expect(sql).not.toMatch(/ALTER|CREATE|DROP|INSERT|UPDATE/i)
    expect(sql).toMatch(/DELETE FROM/)
  })

  it('removes the rows of a list that is not there, from all four tables', () => {
    expect((connection.pragma('foreign_key_check') as unknown[]).length).toBeGreaterThan(0)

    apply(connection, migration!)

    expect(ids('list_items')).toEqual(['live-item'])
    expect(ids('list_groups')).toEqual(['live-group'])
    expect(ids('list_snapshots')).toEqual(['live-snap'])
    expect(ids('dismissed_items')).toEqual(['live-dismissed'])
    expect(connection.pragma('foreign_key_check')).toEqual([])
  })

  it('leaves the lists, and everything that belongs to a list that is there, as it was', () => {
    apply(connection, migration!)

    expect(ids('lists')).toEqual(['live'])
    expect(ids('users')).toEqual(['u1'])
  })

  it('does nothing the second time', () => {
    apply(connection, migration!)
    const before = ids('list_items')

    apply(connection, migration!)

    expect(ids('list_items')).toEqual(before)
  })
})
