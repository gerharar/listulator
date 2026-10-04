import { delay } from './http.js'

export interface RateLimiter {
  /**
   * Runs `fn` once every earlier call has finished and at least the interval
   * has passed since the previous one started. First come, first served; a
   * failing call does not stall the ones behind it.
   */
  run<T>(fn: () => Promise<T>): Promise<T>
}

export interface RateLimiterClock {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * One shared queue in front of an upstream that caps request rate
 * (MusicBrainz asks for one a second; Comic Vine is stricter still).
 *
 * Built once per adapter, so every call that adapter makes — a search, a
 * per-result count, an import — waits in the same line. Without it, ten
 * search results each fetching their own count would all fire at once
 * (task 10.12, Q11). `now`/`sleep` are injectable so the timing is testable
 * without real waiting.
 */
export function createRateLimiter(
  minIntervalMs: number,
  { now = () => Date.now(), sleep = delay }: RateLimiterClock = {},
): RateLimiter {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = Number.NEGATIVE_INFINITY

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const wait = lastStart + minIntervalMs - now()
        if (wait > 0) await sleep(wait)
        lastStart = now()
        return fn()
      })
      tail = result.catch(() => undefined)

      return result
    },
  }
}

/**
 * Spaces the *starts* of requests, and lets them overlap (task 15.9): each call takes the next free slot,
 * `minIntervalMs` after the one before, and runs as soon as its slot comes, whether or not earlier calls
 * have finished. `createRateLimiter` is the other kind: it waits for each call to finish, one at a time,
 * which is what MusicBrainz asks for and would make eight pages in flight into eight in a row. A pacer is for
 * an upstream that caps requests per second (TMDB: 40), not requests at once.
 *
 * The slot is taken the moment `run` is called, so any number of callers arriving together are spaced
 * correctly with no queue to manage. A request that fails costs the others nothing.
 */
export function createPacer(
  minIntervalMs: number,
  { now = () => Date.now(), sleep = delay }: RateLimiterClock = {},
): RateLimiter {
  let nextStart = Number.NEGATIVE_INFINITY

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      const current = now()
      const start = Math.max(current, nextStart)
      nextStart = start + minIntervalMs

      if (start > current) await sleep(start - current)

      return await fn()
    },
  }
}

