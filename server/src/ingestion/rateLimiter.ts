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
  { now = Date.now, sleep = delay }: RateLimiterClock = {},
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
