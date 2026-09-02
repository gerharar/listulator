import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

export type AppDatabase = BetterSQLite3Database<typeof schema>

export interface DatabaseHandle {
  db: AppDatabase
  close: () => void
}

/** Generated migrations live at <server>/drizzle, two levels up from src/db or dist/db. */
const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

export function createDatabase(databasePath: string): DatabaseHandle {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const connection = new Database(databasePath)
  // WAL keeps reads from blocking the writer; foreign keys are off by default
  // in SQLite and we rely on them for list -> items cascades.
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')

  return {
    db: drizzle(connection, { schema }),
    close: () => connection.close(),
  }
}

/** Idempotent; safe to run on every boot. */
export function runMigrations(db: AppDatabase): void {
  migrate(db, { migrationsFolder: MIGRATIONS_DIR })
}
