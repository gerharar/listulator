import type BetterSqlite3 from 'better-sqlite3'
import { sqlBatchThroughHook } from '../isolationHook.testing.js'

/** What the native `sql_batch` answers for one statement (`sql_batch.rs`, `StatementResult`). */
export interface NativeBatchResult {
  rows: unknown[][]
  rowsAffected: number
}

export interface NativeBatchOptions {
  /**
   * The process dies after this many statements of the call have run: the open transaction is rolled back, as SQLite does for a process that
   * ends, and the call rejects with a plain Error, which is what the page sees when the app goes away under it.
   */
  dieAfterStatements?: number
  /** Filled in when it dies: how many statements had run. */
  stats?: { executedBeforeDeath: number }
}

// The plugin numbers its parameters `$1, $2`, in order; better-sqlite3 binds plain `?`.
const positional = (sql: string) => sql.replace(/\$\d+/g, '?')

/**
 * A stand-in for the native `sql_batch` over a real in-memory SQLite, for the tests of the bridge: the hook first (a refusal throws, as in
 * the built app), then `BEGIN IMMEDIATE`, each statement in order, `COMMIT`; a failure rolls back and rejects with `{ statement, message }`,
 * the shape the native command serializes. Rows come back as arrays in column order, as the native command gives them. With
 * `foreignKeysOff` it does what the command does: enforcement off before the transaction, `PRAGMA foreign_key_check` before the commit
 * (a row of it undoes the call), enforcement on again after, whatever happened. What the real command does is proved by its own
 * `cargo test` (`sql_batch.rs`); this only has to behave the same where the bridge looks.
 */
export function nativeSqlBatch(sqlite: BetterSqlite3.Database, options: NativeBatchOptions = {}): (args: unknown) => Promise<NativeBatchResult[]> {
  const throughHook = sqlBatchThroughHook()

  return async (args) => {
    const { statements, foreignKeysOff } = args as { db: string; statements: { query: string; values?: unknown[] }[]; foreignKeysOff?: boolean }
    throughHook(statements, foreignKeysOff)

    if (foreignKeysOff) sqlite.pragma('foreign_keys = OFF')
    try {
      sqlite.prepare('BEGIN IMMEDIATE').run()
      const results: NativeBatchResult[] = []
      for (const [index, statement] of statements.entries()) {
        if (options.dieAfterStatements === index) {
          sqlite.prepare('ROLLBACK').run()
          if (options.stats) options.stats.executedBeforeDeath = index

          return Promise.reject(new Error('simulated crash'))
        }
        try {
          const prepared = sqlite.prepare(positional(statement.query))
          const values = statement.values ?? []
          if (prepared.reader) {
            const rows = prepared.raw().all(...values) as unknown[][]
            results.push({ rows, rowsAffected: rows.length })
          } else {
            results.push({ rows: [], rowsAffected: prepared.run(...values).changes })
          }
        } catch (cause) {
          sqlite.prepare('ROLLBACK').run()

          // Tauri rejects with the serialized error object, not with an Error.
          return Promise.reject({ statement: index, message: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      if (foreignKeysOff) {
        const orphans = sqlite.prepare('PRAGMA foreign_key_check').all()
        if (orphans.length > 0) {
          sqlite.prepare('ROLLBACK').run()

          return Promise.reject({ statement: null, message: `foreign key check failed: ${orphans.length} rows point at nothing` })
        }
      }
      sqlite.prepare('COMMIT').run()

      return results
    } finally {
      if (foreignKeysOff) sqlite.pragma('foreign_keys = ON')
    }
  }
}

/**
 * The `invoke` of `@tauri-apps/api/core` in a test: `sql_batch` runs over the SQLite `getSqlite()` gives (read at each call, since a test
 * replaces its database), any other command is not there, as in a browser. Every test that opens the local database needs it now, because
 * the migrations go through `sql_batch` (53.4); mock the module with `vi.mock('@tauri-apps/api/core', ...)` and this.
 */
export function nativeInvoke(getSqlite: () => BetterSqlite3.Database, options: () => NativeBatchOptions = () => ({})): (command: string, args?: unknown) => Promise<unknown> {
  return async (command, args) => {
    if (command !== 'sql_batch') throw new Error(`invoke(${command}) is not available in this test`)

    return await nativeSqlBatch(getSqlite(), options())(args)
  }
}
