import { invoke } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
// Cross-workspace on purpose: the schema is the shared, portable source of
// truth (docs/DECISIONS.md, "Standalone-app distribution") — the standalone
// app reads the same table definitions the self-hosted server does, rather
// than keeping a second copy that could drift.
import * as schema from '../../../../server/src/db/schema.js'
import { AtomicBatchError } from '../../../../server/src/db/atomic.js'

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
 * Since Phase 53 (53.4) a migration file and its tag row are ONE call of the native `sql_batch`: all the file's statements and the
 * `INSERT` of its tag run in one transaction. A process killed in the middle, or a statement that fails, leaves the schema as it was and
 * the tag absent, and the next start runs the file again from its first statement. (A file that rebuilds a table runs with foreign keys
 * off on a connection of its own, and the two `PRAGMA foreign_keys` lines drizzle-kit writes around it are taken out: see
 * `applyMigration`.)
 *
 * Before that a file was applied statement by statement and its tag recorded last, because a transaction was not available (the hook
 * refused `BEGIN` and the plugin's pool may give each call another connection). A process killed in the middle used to leave the schema
 * half changed with the tag missing, and every start then ran the same statements again and failed ("duplicate column name") for ever
 * (BL-082). Progress was therefore recorded as rows of the same table: `<tag>#start` before the first statement, `<tag>#<n>` after
 * statement n, and the plain tag when all were done (the progress rows were then removed). **A database an older build left in that state
 * is still finished that way** (`finishCutShortMigration`), and this code and `alreadyApplied` stay for one release (BL-174).
 */
export async function runLocalMigrations(connection: Database, migrations: { tag: string; sql: string }[] = orderedMigrations()): Promise<void> {
  await connection.execute(
    'CREATE TABLE IF NOT EXISTS __local_migrations (tag text PRIMARY KEY NOT NULL, applied_at integer NOT NULL)',
  )

  const recorded = new Set(
    (await connection.select<{ tag: string }[]>('SELECT tag FROM __local_migrations')).map(
      (row) => row.tag,
    ),
  )

  for (const { tag, sql } of migrations) {
    if (recorded.has(tag)) {
      // Done, but an older build may have died before it cleared its progress rows.
      if (recorded.has(`${tag}#start`)) await forgetProgress(connection, tag)
      continue
    }

    const statements = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean)

    if (recorded.has(`${tag}#start`)) await finishCutShortMigration(connection, tag, statements, recorded)
    else await applyMigration(tag, statements)
  }
}

const withoutComments = (statement: string) => statement.replace(/--[^\n]*(\n|$)/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim()

/** drizzle-kit's own lines around a table rebuild: `PRAGMA foreign_keys=OFF;` first and `PRAGMA foreign_keys=ON;` last. */
const isForeignKeysPragma = (statement: string) => /^PRAGMA\s+foreign_keys\b/i.test(withoutComments(statement))

const recordTag = (connection: Database, tag: string) =>
  connection.execute('INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)', [tag, Date.now()])

const forgetProgress = (connection: Database, tag: string) =>
  connection.execute('DELETE FROM __local_migrations WHERE tag LIKE $1', [`${tag}#%`])

/**
 * One migration file, its tag row last, in one transaction. A file that holds `PRAGMA foreign_keys` is a table rebuild (drizzle-kit
 * writes it so): those lines are taken out (the hook refuses the OFF, and inside a transaction the pragma does nothing) and the batch is
 * asked to run with enforcement off, which the native command does on a connection of its own and checks (`PRAGMA foreign_key_check`)
 * before it commits, so a rebuild can drop and rename the parent without deleting its children.
 */
async function applyMigration(tag: string, statements: string[]): Promise<void> {
  const body = statements.filter((statement) => !isForeignKeysPragma(statement))

  await runSqlBatch(
    [
      ...body.map((query) => ({ query })),
      { query: 'INSERT INTO __local_migrations (tag, applied_at) VALUES ($1, $2)', values: [tag, Date.now()] },
    ],
    { foreignKeysOff: body.length < statements.length },
  )
}

/**
 * A migration an older build began (its `<tag>#start` row is there) and did not finish: the statements with a row are skipped, and the
 * next one, the only one that may have run without its row being written, is allowed to answer "already done" (`alreadyApplied`). Every
 * other failure stops the start. Unchanged since BL-082; it only ever meets databases an older build left, and goes one release after 53.4.
 */
async function finishCutShortMigration(connection: Database, tag: string, statements: string[], recorded: Set<string>): Promise<void> {
  let next = 0
  while (next < statements.length && recorded.has(`${tag}#${next}`)) next += 1

  for (let index = next; index < statements.length; index += 1) {
    const statement = statements[index]!

    try {
      await connection.execute(statement)
    } catch (error) {
      if (!(index === next && alreadyApplied(statement, error))) throw error
    }

    await recordTag(connection, `${tag}#${index}`)
  }

  await recordTag(connection, tag)
  await forgetProgress(connection, tag)
}

/** What the native `sql_batch` answers for one statement (`sql_batch.rs`, `StatementResult`): rows as arrays in column order. */
interface NativeBatchResult {
  rows: unknown[][]
  rowsAffected: number
}

/** What it rejects with (`BatchError`): the place of the failing statement, or null when the call itself could not run. */
interface NativeBatchFailure {
  statement: number | null
  message: string
}

const isNativeFailure = (cause: unknown): cause is NativeBatchFailure =>
  typeof cause === 'object' && cause !== null && typeof (cause as NativeBatchFailure).message === 'string' && 'statement' in cause

/**
 * Runs a list of statements in ONE transaction through the app's own command `sql_batch` (Phase 53): all of it or none of it. The
 * statements are `{ query, values }` as the SQL plugin takes them; `foreignKeysOff` is for a migration that rebuilds a table (the command
 * runs it on a connection of its own, with enforcement off, and checks the foreign keys before it commits). The isolation hook checks the
 * call before it leaves the page: one to 2,000 statements, at most 64 MiB, values that are text, numbers or null. A failure rejects
 * with an `AtomicBatchError` that says which statement.
 */
export async function runSqlBatch(
  statements: { query: string; values?: unknown[] }[],
  { foreignKeysOff = false }: { foreignKeysOff?: boolean } = {},
): Promise<NativeBatchResult[]> {
  try {
    return await invoke<NativeBatchResult[]>('sql_batch', {
      db: DATABASE,
      statements,
      ...(foreignKeysOff ? { foreignKeysOff: true } : {}),
    })
  } catch (cause) {
    if (isNativeFailure(cause)) throw new AtomicBatchError(cause.statement ?? undefined, cause.message)

    throw new AtomicBatchError(undefined, cause instanceof Error ? cause.message : String(cause), { cause })
  }
}

export type LocalDatabase = ReturnType<typeof drizzle<typeof schema>>

/** The one database file, in the app's config folder: the only name the isolation hook lets the page open. */
const DATABASE = 'sqlite:listulator.sqlite'

let connection: Database | undefined

async function getConnection(): Promise<Database> {
  if (!connection) {
    const opened = await Database.load(DATABASE)
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
    // `db.batch(list)` (`runAtomically`, server/src/db/atomic.ts): the whole list in one call to the native command, one transaction. The
    // answer is the shape of the callback above, per statement: `rows` as arrays, for a `get` the one row.
    async (batch) => {
      const results = await runSqlBatch(batch.map(({ sql, params }) => ({ query: sql, values: params })))

      return results.map(({ rows }, index) => ({ rows: (batch[index]!.method === 'get' ? rows[0] : rows) as unknown[] }))
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
