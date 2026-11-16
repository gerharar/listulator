/**
 * The write lock, as a background writer meets it (Phase 53). A Reset or an import holds SQLite's one write lock for its whole run (about
 * 3.5 s per 50,000 inserts on the Mac, 3.9 to 4.3 s on Windows, measured in 53.0) and any other write waits for it, at most 5 s on the desktop
 * (the SQL plugin's `busy_timeout`) before it fails with "database is locked". Reset and import are atomic now, so nothing is lost; but the
 * runtime fill and the source-copy schedule would give up on a list for the rest of the session. A write that failed for the lock changed
 * nothing, so asking again is safe, and that is all this does.
 */

/** The lock in the words the desktop's plugin, better-sqlite3 and the native batch each give it. A plain string is what the plugin rejects with. */
const BUSY = /database is locked|SQLITE_BUSY|\(code: 5\)/i

/** Drizzle wraps the driver's error and keeps it as the cause; look through a few layers of that. */
const DEPTH = 4

export function isDatabaseBusy(cause: unknown, depth = 0): boolean {
  if (typeof cause === 'string') return BUSY.test(cause)
  if (!(cause instanceof Error)) return false
  if (BUSY.test(cause.message) || (cause as { code?: unknown }).code === 'SQLITE_BUSY') return true

  return depth < DEPTH && cause.cause !== undefined && isDatabaseBusy(cause.cause, depth + 1)
}

export interface RetryOptions {
  /** How many more times to ask after the first. */
  retries?: number
  /** Between one attempt and the next; each attempt has already waited the plugin's 5 s for the lock. */
  waitMs?: number
  sleep?: (ms: number) => Promise<void>
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Runs `run`; when it fails for the lock, asks again, up to `retries` times. Any other failure, and the last lock failure, come out unchanged. */
export async function retryWhenBusy<T>(run: () => Promise<T>, { retries = 3, waitMs = 1000, sleep = sleepFor }: RetryOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (cause) {
      if (attempt >= retries || !isDatabaseBusy(cause)) throw cause
      await sleep(waitMs)
    }
  }
}
