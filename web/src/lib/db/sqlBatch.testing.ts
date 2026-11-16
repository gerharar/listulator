import type BetterSqlite3 from 'better-sqlite3'
import { sqlBatchThroughHook } from '../isolationHook.testing.js'

/** What the native `sql_batch` answers for one statement (`sql_batch.rs`, `StatementResult`). */
export interface NativeBatchResult {
  rows: unknown[][]
  rowsAffected: number
}

// The plugin numbers its parameters `$1, $2`, in order; better-sqlite3 binds plain `?`.
const positional = (sql: string) => sql.replace(/\$\d+/g, '?')

/**
 * A stand-in for the native `sql_batch` over a real in-memory SQLite, for the tests of the bridge: the hook first (a refusal throws, as in
 * the built app), then `BEGIN IMMEDIATE`, each statement in order, `COMMIT`; a failure rolls back and rejects with `{ statement, message }`,
 * the shape the native command serializes. Rows come back as arrays in column order, as the native command gives them. What the real
 * command does is proved by its own `cargo test` (`sql_batch.rs`); this only has to behave the same where the bridge looks.
 */
export function nativeSqlBatch(sqlite: BetterSqlite3.Database): (args: unknown) => Promise<NativeBatchResult[]> {
  const throughHook = sqlBatchThroughHook()

  return async (args) => {
    const { statements, foreignKeysOff } = args as { db: string; statements: { query: string; values?: unknown[] }[]; foreignKeysOff?: boolean }
    throughHook(statements, foreignKeysOff)

    sqlite.prepare('BEGIN IMMEDIATE').run()
    const results: NativeBatchResult[] = []
    for (const [index, statement] of statements.entries()) {
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
    sqlite.prepare('COMMIT').run()

    return results
  }
}
