import { and, eq, isNotNull } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { lists, type List } from '../db/schema.js'
import {
  refreshOrDropSourceCopy,
  type SourceCopyDeps,
  type SourceCopyOutcome,
} from './sourceCopy.js'

/**
 * Keeping fetched lists' source copies within their sources' limits (task
 * 12.4). Shared by the server and the desktop app, like the rest of the copy
 * code; each starts the same schedule with its own database and registry.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The age at which a copy is refreshed, ahead of the day it would have to be
 * dropped: five sixths of the limit, so 25 of YouTube's 30 days and 150 of
 * TMDB's 180. Five days (30) or thirty (180) of retries before a failing
 * refresh costs the copy.
 */
export const refreshAfterDays = (maxDays: number): number => (maxDays * 5) / 6

export interface SourceCopyRunSummary {
  /** Lists that were due and were looked at. */
  checked: number
  refreshed: number
  created: number
  kept: number
  dropped: number
  missing: number
  /** A list the run could not even attempt, for a reason of its own (a write failing). */
  failed: number
}

export type SourceCopyRunResult = SourceCopyOutcome | { outcome: 'failed'; error: unknown }

/**
 * One pass over every fetched list of a category with a limit: a list is due
 * when its copy has reached `refreshAfterDays`, or when it has none (a dropped
 * copy is made again as soon as its source answers, whatever day it is).
 *
 * One list at a time, oldest copy first, so each source's own pacing holds and
 * the copies nearest their limit are served first if the pass is cut short. A
 * failure on one list, from its source or from a write, is reported through
 * `onResult` and never stops the rest.
 */
export async function maintainSourceCopies(
  db: PortableDatabase,
  deps: SourceCopyDeps,
  now: Date = new Date(),
  onResult?: (list: List, result: SourceCopyRunResult) => void,
): Promise<SourceCopyRunSummary> {
  const summary: SourceCopyRunSummary = {
    checked: 0,
    refreshed: 0,
    created: 0,
    kept: 0,
    dropped: 0,
    missing: 0,
    failed: 0,
  }

  const fetched = await db
    .select()
    .from(lists)
    .where(and(eq(lists.source, 'api'), isNotNull(lists.externalRef)))
    .all()

  const due = fetched
    .filter((list) => {
      const mediaType = deps.mediaTypes.find((entry) => entry.key === list.mediaType)
      if (!mediaType?.adapter || !mediaType.sourceCopyMaxDays) return false
      if (!list.snapshotFetchedAt) return true

      return now.getTime() - list.snapshotFetchedAt.getTime() >= refreshAfterDays(mediaType.sourceCopyMaxDays) * DAY_MS
    })
    // No date (a copy to make) goes last: it has nothing running out.
    .sort(
      (a, b) =>
        (a.snapshotFetchedAt?.getTime() ?? Number.POSITIVE_INFINITY) -
        (b.snapshotFetchedAt?.getTime() ?? Number.POSITIVE_INFINITY),
    )

  for (const list of due) {
    summary.checked += 1

    let result: SourceCopyRunResult
    try {
      result = await refreshOrDropSourceCopy(db, list, deps, now)
    } catch (error) {
      result = { outcome: 'failed', error }
    }

    if (result.outcome !== 'none') summary[result.outcome] += 1
    onResult?.(list, result)
  }

  return summary
}

export interface SourceCopyScheduleOptions {
  intervalMs?: number
  /** A run that threw (not a list that failed: those are in the run's own report). */
  onError?: (error: unknown) => void
}

/**
 * Runs `run` at once and then every day for as long as the process lives.
 * A run that is still going when the next is due makes that one skip, so two
 * passes never overlap. Returns a function that stops the schedule.
 */
export function startSourceCopySchedule(
  run: () => Promise<unknown>,
  { intervalMs = DAY_MS, onError }: SourceCopyScheduleOptions = {},
): () => void {
  let running = false

  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await run()
    } catch (error) {
      onError?.(error)
    } finally {
      running = false
    }
  }

  void tick()
  const timer = setInterval(() => void tick(), intervalMs)
  // A pending daily check must not keep a server that is shutting down alive.
  ;(timer as { unref?: () => void }).unref?.()

  return () => clearInterval(timer)
}
