import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../../../server/src/db/schema.js'
import type { LocalDatabase } from './localDb.js'

/**
 * The first launch on a fresh machine: the home screen and another start-up call both ask who the local user is before
 * either has finished creating them. Both used to find nobody and both inserted, and the second hit `users_one_default_local`:
 * "Couldn't load your lists" on the very first start (seen on the first Windows run of 1.1.0). The users table is the real one,
 * with its unique index.
 */
function freshDatabase(): LocalDatabase {
  const sqlite = new BetterSqlite3(':memory:')
  sqlite.exec(`
    CREATE TABLE users (id text PRIMARY KEY NOT NULL, is_default_local_user integer NOT NULL DEFAULT 0, created_at integer NOT NULL);
    CREATE UNIQUE INDEX users_one_default_local ON users (is_default_local_user) WHERE is_default_local_user = 1;
  `)

  return drizzle(sqlite, { schema }) as unknown as LocalDatabase
}

describe('getLocalCurrentUser', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('gives every caller of a first launch the same one user', async () => {
    const { getLocalCurrentUser } = await import('./localUser.js')
    const db = freshDatabase()

    const [first, second, third] = await Promise.all([getLocalCurrentUser(db), getLocalCurrentUser(db), getLocalCurrentUser(db)])

    expect(second.id).toBe(first.id)
    expect(third.id).toBe(first.id)
    expect(db.select().from(schema.users).all()).toHaveLength(1)
  })

  it('tries again after a failure instead of remembering it', async () => {
    const { getLocalCurrentUser } = await import('./localUser.js')
    const db = freshDatabase()
    const broken = { select: () => { throw new Error('database is locked') } } as unknown as LocalDatabase

    await expect(getLocalCurrentUser(broken)).rejects.toThrow('database is locked')
    await expect(getLocalCurrentUser(db)).resolves.toMatchObject({ isDefaultLocalUser: true })
  })
})
