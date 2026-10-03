import { asc, eq } from 'drizzle-orm'
import type { PortableDatabase } from '../db/client.js'
import { lists } from '../db/schema.js'
import { delay, UpstreamError } from '../ingestion/http.js'
import type { MediaType, RuntimeLookup } from '../ingestion/mediaTypes.js'
import { createRateLimiter, type RateLimiter } from '../ingestion/rateLimiter.js'
import {
  applyRuntimes,
  estimatedRefsFor,
  knownRuntimes,
  pendingFor,
  pruneExpiredRuntimes,
  recordRuntimes,
  type RuntimeRow,
} from './runtimes.js'
import { refreshAfterDays } from './sourceCopyLimits.js'

/**
 * Fills in the lengths of a list built from a listing (task 15.4): the items
 * start with the category's estimate, and this looks each one up afterwards,
 * eight at a time, and writes it into the list. The same code runs on the
 * server and in the desktop webview, each with its own database and registry
 * (the way `maintainSourceCopies` does), so nothing here reaches for either.
 *
 * It keeps no state of its own that matters: what is still to do is worked out
 * from the database (`pendingFor`), so a restart, a crash or closing the app
 * resumes where it left off and a list opened later is topped up the same way.
 *
 * A system-level worker: it takes a list id and is only to be started by code
 * that has already decided the list is to be filled (after a build, at start,
 * when a list is opened), behind the usual ownership checks.
 */

/** Items per lookup call, and so the most requests in flight for one list. */
const BATCH_SIZE = 8
/** A source that answers nothing this many batches running is left alone until the next start. */
const MAX_FAILED_BATCHES_IN_A_ROW = 3
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 30_000
/** The longest a source's own `Retry-After` is waited out between batches. */
const RETRY_AFTER_MAX_MS = 60_000
/** How long an answer is kept when the category has no copy limit to derive it from. */
const DEFAULT_TTL_DAYS = 25
/** One batch every this long is about 40 requests a second: TMDB's published budget. */
export const RUNTIME_BATCH_INTERVAL_MS = 200

export interface RuntimeFillDeps {
  db: PortableDatabase
  mediaTypes: readonly MediaType[]
  /** Injectable so expiry is testable without waiting. */
  now?: () => Date
  /** Injectable so the backoff is testable without waiting. */
  sleep?: (ms: number) => Promise<void>
  /** Stops the run after the batch in hand, or at once if it is backing off. */
  signal?: AbortSignal
  /**
   * The limiter for a source (by its `sourceName`): every runner on one source
   * must be given the same one, so two lists, or two categories, on TMDB take
   * turns. Absent: no pacing beyond the batches themselves.
   */
  limiterFor?: (sourceName: string | undefined) => RateLimiter | undefined
}

export type FillOutcome =
  /** Everything that could be asked has been (what failed stays pending). */
  | 'done'
  | 'aborted'
  /** The list was not there, or was deleted while the run was going. */
  | 'list-gone'
  /** The list's category has no source that can look lengths up. */
  | 'unsupported'
  /** It has one, but it cannot answer now (usually a missing API key): nothing is asked. */
  | 'unavailable'
  /** The source answered nothing for several batches running: tried again at the next start. */
  | 'upstream-unavailable'

export interface FillResult {
  outcome: FillOutcome
  /** Lengths looked up and written in this run. */
  filled: number
  /** Lengths the list already could have, taken from what another list looked up. */
  adopted: number
  /** Items the source has no length for: a known answer, not asked again. */
  none: number
  /** Lookups that did not get through: still pending. */
  failed: number
  /** Still pending when the run ended: the progress. */
  pending: number
}

/** One limiter per source name, made on first use, so runners given the same function share them. */
export function createSourceLimiters(
  intervalMs: number = RUNTIME_BATCH_INTERVAL_MS,
): (sourceName: string | undefined) => RateLimiter {
  const limiters = new Map<string, RateLimiter>()

  return (sourceName) => {
    const key = sourceName ?? ''
    let limiter = limiters.get(key)
    if (!limiter) {
      limiter = createRateLimiter(intervalMs)
      limiters.set(key, limiter)
    }

    return limiter
  }
}

/**
 * For each category whose source can look lengths up and can answer right now (it has a key), the kinds
 * of item ref it looks up. What the list stats and the runner use to find what is pending.
 */
export function enrichPrefixesByMediaType(
  mediaTypes: readonly MediaType[],
): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>()

  for (const mediaType of mediaTypes) {
    const adapter = mediaType.adapter
    const prefixes = adapter?.enrichPrefixes ?? []
    if (adapter?.enrich && prefixes.length > 0 && adapter.isAvailable()) map.set(mediaType.key, prefixes)
  }

  return map
}

/** `'aborted'` as soon as the signal fires, otherwise once the wait is over. */
async function waitUnlessAborted(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<'waited' | 'aborted'> {
  if (signal?.aborted) return 'aborted'

  let onAbort: (() => void) | undefined
  const aborted = new Promise<'aborted'>((resolve) => {
    onAbort = () => resolve('aborted')
    signal?.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([sleep(ms).then((): 'waited' => 'waited'), aborted])
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

export function createRuntimeFiller({
  db,
  mediaTypes,
  now = () => new Date(),
  sleep = delay,
  signal,
  limiterFor,
}: RuntimeFillDeps) {
  /** One run per list: asking again while one is going gets that run. */
  const running = new Map<string, Promise<FillResult>>()

  const supportFor = (mediaTypeKey: string) => {
    const mediaType = mediaTypes.find((entry) => entry.key === mediaTypeKey)
    const adapter = mediaType?.adapter
    const prefixes = adapter?.enrichPrefixes ?? []

    return mediaType && adapter?.enrich && prefixes.length > 0
      ? { mediaType, enrich: adapter.enrich.bind(adapter), prefixes }
      : undefined
  }

  const listRow = async (listId: string) =>
    await db.select({ mediaType: lists.mediaType }).from(lists).where(eq(lists.id, listId)).get()

  async function run(listId: string): Promise<FillResult> {
    const result: FillResult = { outcome: 'done', filled: 0, adopted: 0, none: 0, failed: 0, pending: 0 }

    const list = await listRow(listId)
    if (!list) return { ...result, outcome: 'list-gone' }

    const support = supportFor(list.mediaType)
    if (!support) return { ...result, outcome: 'unsupported' }
    const { mediaType, enrich, prefixes } = support

    const finish = async (outcome: FillOutcome): Promise<FillResult> => ({
      ...result,
      outcome,
      pending: (await pendingFor(db, listId, now(), prefixes)).length,
    })

    // Nothing is asked of a source that cannot answer (no key): it would only fail, three batches running.
    if (!mediaType.adapter!.isAvailable()) return await finish('unavailable')

    // Lapsed answers go first, so a film whose answer lapsed is asked again.
    await pruneExpiredRuntimes(db, now())

    // What another list already looked up goes into this one without a request.
    const estimated = await estimatedRefsFor(db, listId, prefixes)
    const known = await knownRuntimes(db, estimated, now())
    const adopted = estimated.flatMap((ref) => {
      const minutes = known.get(ref)

      return typeof minutes === 'number' ? [{ ref, minutes }] : []
    })
    await applyRuntimes(db, listId, adopted)
    result.adopted = adopted.length

    const pending = estimated.filter((ref) => !known.has(ref))
    const ttlDays = mediaType.sourceCopyMaxDays ? refreshAfterDays(mediaType.sourceCopyMaxDays) : DEFAULT_TTL_DAYS
    const limiter = limiterFor?.(mediaType.sourceName)

    const ask = async (batch: string[]): Promise<Map<string, RuntimeLookup>> => {
      try {
        return await (limiter ? limiter.run(() => enrich(batch)) : enrich(batch))
      } catch (error) {
        // A call that fails as a whole is every ref in it failed, never a reason to stop the worker.
        return new Map(batch.map((ref): [string, RuntimeLookup] => [ref, { status: 'failed', error }]))
      }
    }

    let failedBatchesInARow = 0

    for (let start = 0; start < pending.length; start += BATCH_SIZE) {
      if (signal?.aborted) return await finish('aborted')
      if (!(await listRow(listId))) return await finish('list-gone')

      const batch = pending.slice(start, start + BATCH_SIZE)
      const answers = await ask(batch)

      const found: { ref: string; minutes: number }[] = []
      const recorded: RuntimeRow[] = []
      const failures: unknown[] = []

      for (const ref of batch) {
        // A ref the source did not answer at all is a failure too, and nothing is recorded for it.
        const answer = answers.get(ref) ?? { status: 'failed', error: new Error('no answer') }

        if (answer.status === 'found') {
          found.push({ ref, minutes: answer.minutes })
          recorded.push({ ref, minutes: answer.minutes })
        } else if (answer.status === 'none') {
          recorded.push({ ref, minutes: null })
        } else {
          failures.push(answer.error)
        }
      }

      // The answers are kept first, the list written second: a run cut off between the two leaves
      // the list's estimates to be filled from the table at the next start (`adopted`).
      await recordRuntimes(db, recorded, { now: now(), ttlDays })
      await applyRuntimes(db, listId, found)

      result.filled += found.length
      result.none += recorded.length - found.length
      result.failed += failures.length

      if (failures.length < batch.length) {
        failedBatchesInARow = 0
        continue
      }

      failedBatchesInARow += 1
      if (failedBatchesInARow >= MAX_FAILED_BATCHES_IN_A_ROW) return await finish('upstream-unavailable')

      // The wait the source itself asked for, else a doubling one.
      const asked = Math.max(
        0,
        ...failures.map((error) => (error instanceof UpstreamError ? (error.retryAfterMs ?? 0) : 0)),
      )
      const backoff = asked > 0 ? Math.min(asked, RETRY_AFTER_MAX_MS) : Math.min(BACKOFF_BASE_MS * 2 ** (failedBatchesInARow - 1), BACKOFF_MAX_MS)

      if ((await waitUnlessAborted(sleep, backoff, signal)) === 'aborted') return await finish('aborted')
    }

    return await finish('done')
  }

  /**
   * Looks up the lengths still missing from a list. Never throws for a thing
   * that goes wrong while it runs (a source failing, the list or an item
   * deleted): it ends with an outcome, and what is not done stays pending.
   * One run per list: asking again while one is going gets that run.
   */
  function fill(listId: string): Promise<FillResult> {
    const existing = running.get(listId)
    if (existing) return existing

    const started = run(listId).finally(() => running.delete(listId))
    running.set(listId, started)

    return started
  }

  return {
    fill,

    /**
     * Fills every list that has something to look up, one at a time and oldest first (a source's limiter
     * is shared, so there is nothing to gain from several at once). What a server does at start and the
     * desktop at launch: a list's own pending state is in the database, so this resumes whatever was cut
     * off. A list whose films another list has since looked up is topped up without a request. Returns
     * how many lists it ran for.
     */
    async fillAll(): Promise<{ lists: number }> {
      const everyList = await db
        .select({ id: lists.id, mediaType: lists.mediaType })
        .from(lists)
        .orderBy(asc(lists.createdAt), asc(lists.id))
        .all()

      let ran = 0
      for (const { id, mediaType } of everyList) {
        if (signal?.aborted) break

        const support = supportFor(mediaType)
        if (!support || !support.mediaType.adapter!.isAvailable()) continue
        if ((await estimatedRefsFor(db, id, support.prefixes)).length === 0) continue

        await fill(id)
        ran += 1
      }

      return { lists: ran }
    },

    /** How many items of the list are still waiting for a length: the progress. */
    async pendingCount(listId: string): Promise<number> {
      const list = await listRow(listId)
      const support = list ? supportFor(list.mediaType) : undefined

      return support ? (await pendingFor(db, listId, now(), support.prefixes)).length : 0
    },
  }
}

export type RuntimeFiller = ReturnType<typeof createRuntimeFiller>
