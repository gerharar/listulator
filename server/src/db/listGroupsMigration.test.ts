import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The `list_groups` migration (task 10.16, D3) against data that already
 * exists. Migrations 0000–0014 are applied first, rows are inserted the way
 * they would already be on a real install, and only then is 0015 applied —
 * so the backfill is tested on what it will actually meet.
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

const migrationFile = files.find((name) => name.startsWith('0015_'))

describe('0015 list_groups migration', () => {
  let connection: Database.Database

  beforeEach(() => {
    connection = new Database(':memory:')
    connection.pragma('foreign_keys = ON')
    for (const name of files.filter((entry) => entry < '0015')) apply(connection, name)

    connection.exec(`INSERT INTO users (id, is_default_local_user, created_at) VALUES ('u1', 1, 0)`)
  })

  afterEach(() => connection.close())

  function insertList(id: string): void {
    connection
      .prepare(
        `INSERT INTO lists (id, user_id, title, media_type, source, created_at, updated_at)
         VALUES (?, 'u1', ?, 'tv', 'manual', 0, 0)`,
      )
      .run(id, id)
  }

  function insertItem(listId: string, title: string, orderIndex: number, group: string | null) {
    connection
      .prepare(
        `INSERT INTO list_items (id, list_id, title, order_index, time_to_consume_minutes, "group", created_at, updated_at)
         VALUES (?, ?, ?, ?, 30, ?, 0, 0)`,
      )
      .run(`${listId}-${title}`, listId, title, orderIndex, group)
  }

  const groupsOf = (listId: string) =>
    connection
      .prepare(`SELECT name, order_index FROM list_groups WHERE list_id = ? ORDER BY order_index`)
      .all(listId) as { name: string; order_index: number }[]

  it('exists as a migration file', () => {
    expect(migrationFile).toBeDefined()
  })

  it('makes one group per distinct label, in the order each label first appears', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, 'Season 1')
    insertItem('L1', 'b', 1, 'Season 1')
    insertItem('L1', 'c', 2, 'Season 2')
    insertItem('L1', 'd', 3, 'Season 3')

    apply(connection, migrationFile!)

    expect(groupsOf('L1')).toEqual([
      { name: 'Season 1', order_index: 0 },
      { name: 'Season 2', order_index: 1 },
      { name: 'Season 3', order_index: 2 },
    ])
  })

  it('orders by where a label first appears, not by its name or its last item', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, 'Zeta')
    insertItem('L1', 'b', 1, 'Alpha')
    insertItem('L1', 'c', 2, 'Zeta')

    apply(connection, migrationFile!)

    expect(groupsOf('L1').map((group) => group.name)).toEqual(['Zeta', 'Alpha'])
  })

  it('leaves ungrouped and blank-labelled items out', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, null)
    insertItem('L1', 'b', 1, '')
    insertItem('L1', 'c', 2, 'Only')

    apply(connection, migrationFile!)

    expect(groupsOf('L1')).toEqual([{ name: 'Only', order_index: 0 }])
  })

  it('numbers each list from zero, independently', () => {
    insertList('L1')
    insertList('L2')
    insertItem('L1', 'a', 0, 'X')
    insertItem('L2', 'a', 0, 'X')
    insertItem('L2', 'b', 1, 'Y')

    apply(connection, migrationFile!)

    expect(groupsOf('L1')).toEqual([{ name: 'X', order_index: 0 }])
    expect(groupsOf('L2')).toEqual([
      { name: 'X', order_index: 0 },
      { name: 'Y', order_index: 1 },
    ])
  })

  it('keeps every item and its label as they were', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, 'Season 1')

    apply(connection, migrationFile!)

    expect(
      connection.prepare(`SELECT title, "group", order_index FROM list_items`).all(),
    ).toEqual([{ title: 'a', group: 'Season 1', order_index: 0 }])
  })

  it('does nothing to a database with no grouped items', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, null)

    apply(connection, migrationFile!)

    expect(groupsOf('L1')).toEqual([])
  })

  it('removes a list’s groups with the list', () => {
    insertList('L1')
    insertItem('L1', 'a', 0, 'X')
    apply(connection, migrationFile!)

    connection.prepare(`DELETE FROM lists WHERE id = 'L1'`).run()

    expect(groupsOf('L1')).toEqual([])
  })

  it('refuses the same group name twice in one list', () => {
    insertList('L1')
    apply(connection, migrationFile!)
    const insert = connection.prepare(
      `INSERT INTO list_groups (id, list_id, name, order_index, created_at, updated_at) VALUES (?, 'L1', 'X', ?, 0, 0)`,
    )
    insert.run('g1', 0)

    expect(() => insert.run('g2', 1)).toThrow(/UNIQUE/)
  })
})
