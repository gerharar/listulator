import { existsSync, statSync } from 'node:fs'
import Database from 'better-sqlite3'

/**
 * BL-151. Deleting a list frees its pages inside the database file, which SQLite keeps for reuse but never gives back: the owner's
 * Windows dev database was 31 MB for one list of 77 items (99.6% free pages), and the deleted lists' titles stayed readable in them.
 * On start, when the free space is worth the rewrite, the file is vacuumed. The desktop does the same in Rust
 * (`apps/desktop/src-tauri/src/vacuum.rs`); keep the two thresholds equal (`vacuumThresholds.guard.test.ts` reads both).
 */
export const MIN_FREE_BYTES = 8 * 1024 * 1024
export const MIN_FREE_SHARE = 0.25

export interface PageCounts {
  pageSize: number
  pageCount: number
  freelistCount: number
}

/** Both: at least 8 MiB would come back (a small file is never rewritten for a few pages), and at least a quarter of the file. */
export function worthVacuuming({ pageSize, pageCount, freelistCount }: PageCounts): boolean {
  if (pageSize <= 0 || pageCount <= 0) return false

  return freelistCount * pageSize >= MIN_FREE_BYTES && freelistCount >= pageCount * MIN_FREE_SHARE
}

export interface ReclaimResult {
  vacuumed: boolean
  bytesBefore: number
  bytesAfter: number
  /** Why it did not, when something went wrong (a locked or unreadable file); absent for "not worth it". */
  error?: string
}

/**
 * Vacuums the database at `databasePath` when `worthVacuuming` says so. Never throws and never creates a file: a missing or in-memory
 * database, a file that is not one, another connection holding it (`busyMs` is how long to wait), a full disk (the vacuum then
 * fails whole, and SQLite leaves the original as it was) all end as `vacuumed: false`. Run before the app's own connection is opened.
 */
export function reclaimFreeSpace(databasePath: string, options: { busyMs?: number } = {}): ReclaimResult {
  const none: ReclaimResult = { vacuumed: false, bytesBefore: 0, bytesAfter: 0 }
  if (databasePath === ':memory:' || !existsSync(databasePath)) return none

  const bytesBefore = statSync(databasePath).size
  let connection: Database.Database | undefined
  try {
    connection = new Database(databasePath, { fileMustExist: true, timeout: options.busyMs ?? 2000 })
    const counts: PageCounts = {
      pageSize: connection.pragma('page_size', { simple: true }) as number,
      pageCount: connection.pragma('page_count', { simple: true }) as number,
      freelistCount: connection.pragma('freelist_count', { simple: true }) as number,
    }
    if (!worthVacuuming(counts)) return { ...none, bytesBefore, bytesAfter: bytesBefore }

    connection.exec('VACUUM')
    // A WAL database writes the vacuumed copy to its log first; fold it into the file so the file really is small.
    connection.pragma('wal_checkpoint(TRUNCATE)')
    connection.close()
    connection = undefined

    return { vacuumed: true, bytesBefore, bytesAfter: statSync(databasePath).size }
  } catch (cause) {
    return { vacuumed: false, bytesBefore, bytesAfter: bytesBefore, error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    try {
      connection?.close()
    } catch {
      // Already closed or never opened.
    }
  }
}
