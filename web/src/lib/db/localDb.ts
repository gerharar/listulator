import Database from '@tauri-apps/plugin-sql'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
// Cross-workspace on purpose: the schema is the shared, portable source of
// truth (docs/DECISIONS.md, "Standalone-app distribution") — the standalone
// app reads the same table definitions the self-hosted server does, rather
// than keeping a second copy that could drift.
import * as schema from '../../../../server/src/db/schema.js'

/**
 * Local SQLite storage for the standalone desktop/mobile app, via Tauri's
 * `@tauri-apps/plugin-sql` (real SQLite, not WASM) bridged to Drizzle's
 * `sqlite-proxy` driver. `catalog/repository.ts` runs against this
 * unmodified — it only depends on getting a Drizzle-shaped database, not on
 * which driver backs it.
 *
 * Drizzle's own `migrate()` for this driver cannot run here: it still reads
 * `config.migrationsFolder` via `node:fs` internally before handing SQL to
 * the proxy callback, and `node:fs` does not exist inside a webview. See
 * `runLocalMigrations` below for the hand-rolled equivalent this uses
 * instead — confirmed against the installed `drizzle-orm` package's own
 * `.d.ts` files, not assumed from documentation.
 */

const MIGRATION_MODULES = import.meta.glob('../../../../server/drizzle/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** drizzle-kit's migration filenames are zero-padded, so lexical order is chronological order. */
function orderedMigrations(): { tag: string; sql: string }[] {
  return Object.entries(MIGRATION_MODULES)
    .map(([path, sql]) => ({ tag: path.split('/').pop()!.replace(/\.sql$/, ''), sql }))
    .sort((a, b) => a.tag.localeCompare(b.tag))
}

/**
 * What SQLite answers when a statement that has already run is run again, for the kinds of statement a migration holds.
 * Only the one statement that may have run before a crash is judged by this (see `runLocalMigrations`); anything else it
 * answers is a real error and stops the start.
 */
export function alreadyApplied(statement: string, error: unknown): boolean {
  const kind = statement
    .replace(/--[^\n]*(\n|$)/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .toUpperCase()
  const message = error instanceof Error ? error.message : String(error)

  if (/^ALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/.test(kind)) return /no such column/i.test(message)
  if (/^ALTER\s+TABLE\b[\s\S]*\bADD\b/.test(kind)) return /duplicate column name/i.test(message)
  if (/^CREATE\b/.test(kind)) return /already exists/i.test(message)
  if (/^DROP\b/.test(kind)) return /no such (table|index)/i.test(message)
  // A single INSERT is all or nothing, so a unique key it now trips over is its own earlier rows (the backfill of 0015).
  if (/^INSERT\b/.test(kind)) return /UNIQUE constraint failed/i.test(message)

  return false
}

/**
 * Own tracking table, deliberately not Drizzle's `__drizzle_migrations` name
 * — that name implies Drizzle's migrator wrote it, and it did not.
 *
 * A migration file is applied statement by statement and its tag is recorded last. A transaction would make that atomic
 * but is not available: the isolation hook refuses `BEGIN` and a second statement in one call, and the plugin's pool may
 * give each call another connection. So a process killed in the middle used to leave the schema half changed with the tag
 * missing, and every start then ran the same statements again and failed ("duplicate column name") for ever (BL-082).
 * Progress is therefore recorded as rows of the same table: `<tag>#start` before the first statement, `<tag>#<n>` after
 * statement n, and the plain tag when all are done (the progress rows are then removed). On a start that finds `#start`
 * without the tag, the statements with a row are skipped, and the next one, the only one that may have run without its
 * row being written, is allowed to answer "already done" (`alreadyApplied`). Every other failure stops the start, and so
 * does any failure on a first attempt.
 */
async function runLocalMigrations(connection: Database): Promise<void> {
  await connection.execute(
    'CREATE TABLE IF NOT EXISTS __local_migrations (tag text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)',
  )

  const recorded = new Set(
    (await connection.select<{ tag: string }[]>('SELECT tag FROM __local_migrations')).map(
      (row) => row.tag,
    ),
  )

  const record = (tag: string) =>
    connection.execute('INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)', [tag, Date.now()])
  const forgetProgress = (tag: string) =>
    connection.execute('DELETE FROM __local_migrations WHERE tag LIKE $1', [`${tag}#%`])

  for (const { tag, sql } of orderedMigrations()) {
    if (recorded.has(tag)) {
      // Done, but the process may have died before it cleared its progress rows.
      if (recorded.has(`${tag}#start`)) await forgetProgress(tag)
      continue
    }

    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)

    const resuming = recorded.has(`${tag}#start`)
    let next = 0
    while (next < statements.length && recorded.has(`${tag}#${next}`)) next += 1

    if (!resuming) await record(`${tag}#start`)

    for (let index = next; index < statements.length; index += 1) {
      const statement = statements[index]!

      try {
        await connection.execute(statement)
      } catch (error) {
        if (!(resuming && index === next && alreadyApplied(statement, error))) throw error
      }

      await record(`${tag}#${index}`)
    }

    await record(tag)
    await forgetProgress(tag)
  }
}

export type LocalDatabase = ReturnType<typeof drizzle<typeof schema>>

let connection: Database | undefined

async function getConnection(): Promise<Database> {
  if (!connection) {
    const opened = await Database.load('sqlite:listulator.sqlite')
    // Off by default in SQLite, same as the server's own connection
    // (db/client.ts) — deleteList's cascade to list_items depends on it.
    await opened.execute('PRAGMA foreign_keys = ON')
    // Kept only once it is fully set up, so a retry after a failure here starts over.
    connection = opened
  }

  return connection
}

/**
 * Bridges Drizzle's async proxy callback to the plugin's `select`/`execute`.
 *
 * Routes on Drizzle's `method`, not on sniffing the SQL text for `SELECT` —
 * `repository.ts` relies heavily on `INSERT ... RETURNING` (via
 * `.returning().get()`), which is not syntactically a SELECT but still
 * needs `method: 'get'`'s row data back. Only `'run'` (no row data
 * expected — a bare `.run()` call) goes through `execute()`; everything
 * else goes through `select()`, RETURNING clauses included.
 *
 * The `'get'` shape is easy to get wrong: per `sqlite-proxy/session.js`,
 * `rows` must be the single row's own value array directly, not an array
 * containing it — `{ rows: [a, b, c] }`, not `{ rows: [[a, b, c]] }`. An
 * empty/undefined value there is what lets a `.get()` with no match resolve
 * to `undefined`, which every ownership check in `repository.ts` depends on.
 */
async function openLocalDb(): Promise<LocalDatabase> {
  const sqlite = await getConnection()
  await runLocalMigrations(sqlite)

  return drizzle<typeof schema>(
    async (sql, params, method) => {
      if (method === 'run') {
        await sqlite.execute(sql, params)
        return { rows: [] }
      }

      const rows = (await sqlite.select<Record<string, unknown>[]>(sql, params)).map((row) =>
        Object.values(row),
      )

      // Drizzle's own callback type says `rows: any[]`, always an array —
      // but its runtime (`sqlite-proxy/session.js`, `mapGetResult`) checks
      // `if (!row) return undefined`, so a missing 'get' match genuinely
      // needs `rows` itself to be falsy here, not an empty array (`[]` is
      // truthy). The cast documents that mismatch; it isn't a workaround
      // for our own code being wrong.
      return { rows: (method === 'get' ? rows[0] : rows) as unknown[] }
    },
    { schema },
  )
}

let opening: Promise<LocalDatabase> | undefined

/**
 * The one local database, opened and migrated once. Several API calls ask for
 * it at start-up before any has finished, so what is remembered is the opening
 * in progress, not its result: each caller used to open and migrate on its own,
 * and on the first launch after a migration the second `ALTER TABLE ... ADD`
 * failed ("Couldn't load your lists", BL-032). A failed opening is forgotten so
 * the next call tries again.
 */
export function createLocalDb(): Promise<LocalDatabase> {
  opening ??= openLocalDb().catch((cause: unknown) => {
    opening = undefined
    throw cause
  })

  return opening
}
