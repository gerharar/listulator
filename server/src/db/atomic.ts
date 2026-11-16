import type { BatchItem } from 'drizzle-orm/batch'
import type { PortableDatabase } from './client.js'

/**
 * Runs a list of statements in ONE transaction, on the server's driver and on the desktop's, so a rewrite that stops half-way (a closed
 * laptop, a crash, a failing statement) leaves nothing of itself behind (Phase 53; docs/DECISIONS.md, "53.0 spike done").
 *
 * The statements are Drizzle query builders that have NOT been run: `db.insert(...).values(...)`, never `await`ed. A list, not a callback,
 * on purpose: the server's `better-sqlite3` transaction is synchronous, so wrapping async code in it would commit before the awaits
 * resolve (the objection that kept H-012 without a transaction), and the desktop sends the whole list to the native `sql_batch` in one
 * call, which cannot call back into the page. Everything a rewrite reads is read BEFORE the list is built; the list is only writes and the
 * reads that must see those writes.
 *
 * - The server (`better-sqlite3`, synchronous): every statement runs in one native transaction with no `await` inside it. The builders
 *   are bound to `db`, not to the transaction object, and still run inside it: the server has one connection.
 * - The desktop (`sqlite-proxy`): `db.batch(list)`, whose callback (`localDb.ts`) sends the list to `sql_batch`, the native command that
 *   runs it between `BEGIN IMMEDIATE` and `COMMIT`.
 *
 * What comes back is one entry per statement, in order: the rows (as the builder maps them) of a statement that returns rows, a select or
 * a write with `returning()`; `undefined` for any other write (a driver's count of changes differs between the two, so none is promised: ask
 * for `returning()` where the answer matters). A statement that fails undoes the whole call and throws an `AtomicBatchError` that says
 * which one.
 */
export type AtomicStatement = BatchItem<'sqlite'>

/** For each statement, its rows if it gives rows (a `select`, or a write with `returning()`), else `undefined`. */
export type AtomicResults<T extends readonly AtomicStatement[]> = {
  -readonly [K in keyof T]: T[K]['_']['result'] extends unknown[] ? T[K]['_']['result'] : undefined
}

/** The call failed and nothing of it was kept. `statement` is the place (from 0) of the one that failed; none when the batch itself could not run. */
export class AtomicBatchError extends Error {
  constructor(
    readonly statement: number | undefined,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(statement === undefined ? `The batch failed: ${detail}` : `The batch failed at statement ${statement}: ${detail}`, options)
    this.name = 'AtomicBatchError'
  }
}

/**
 * By name, not `instanceof`: the error is made in `localDb.ts` and checked here, and a bundle or a test that loads this file twice has two
 * classes of the same name.
 */
export function isAtomicBatchError(cause: unknown): cause is AtomicBatchError {
  return cause instanceof Error && cause.name === 'AtomicBatchError'
}

/** What the desktop's database has and the server's does not: Drizzle's `batch`, which `localDb.ts` wires to the native command. */
interface Batching {
  batch: (statements: readonly AtomicStatement[]) => Promise<unknown[]>
}

/** What the server's database offers: a synchronous native transaction. */
interface SyncTransactional {
  transaction: <R>(run: () => R, config?: { behavior?: 'deferred' | 'immediate' | 'exclusive' }) => R
}

/** A builder's prepared form, which every Drizzle builder offers (`.prepare()`); on a synchronous driver its result has `.sync()`. */
interface Preparable {
  prepare: () => { execute: () => { sync?: () => unknown } }
}

export async function runAtomically<const T extends readonly AtomicStatement[]>(db: PortableDatabase, statements: T): Promise<AtomicResults<T>> {
  if (statements.length === 0) return [] as unknown as AtomicResults<T>

  const results = isBatching(db) ? await onDesktop(db, statements) : onServer(db as unknown as SyncTransactional, statements)

  return results.map((result) => (Array.isArray(result) ? result : undefined)) as unknown as AtomicResults<T>
}

function isBatching(db: unknown): db is Batching {
  return typeof (db as Partial<Batching>).batch === 'function'
}

async function onDesktop(db: Batching, statements: readonly AtomicStatement[]): Promise<unknown[]> {
  try {
    return await db.batch(statements)
  } catch (cause) {
    // `localDb.ts` already says which statement; anything else (the page could not reach the app) is the batch's own failure.
    throw isAtomicBatchError(cause) ? cause : new AtomicBatchError(undefined, detailOf(cause), { cause })
  }
}

function onServer(db: SyncTransactional, statements: readonly AtomicStatement[]): unknown[] {
  try {
    // `immediate`: the write lock is taken at the start, so the call either has it or fails at once, as the native command does.
    return db.transaction(
      () => {
        let at = 0
        try {
          return statements.map((statement, index) => {
            at = index

            return runNow(statement)
          })
        } catch (cause) {
          // better-sqlite3 rolls the transaction back as the error leaves it.
          throw new AtomicBatchError(at, detailOf(cause), { cause })
        }
      },
      { behavior: 'immediate' },
    )
  } catch (cause) {
    // The driver runs BEGIN and COMMIT outside the function above: a busy file or a commit that fails ends up here, not there.
    throw isAtomicBatchError(cause) ? cause : new AtomicBatchError(undefined, detailOf(cause), { cause })
  }
}

function runNow(statement: AtomicStatement): unknown {
  const executed = (statement as unknown as Preparable).prepare().execute()
  if (typeof executed.sync !== 'function') throw new Error('this driver cannot run a statement synchronously')

  return executed.sync()
}

/** The database's own words: Drizzle wraps the driver's error ("Failed query: ...") and keeps it as the cause. */
export function detailOf(cause: unknown): string {
  if (cause instanceof Error && cause.cause instanceof Error) return cause.cause.message
  if (cause instanceof Error) return cause.message

  return String(cause)
}
