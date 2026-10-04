/** Anything `fetch`-shaped, so adapters can be tested without real network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class IngestionError extends Error {}

/**
 * The upstream answered, and the answer was a failure. Carries the status so a
 * caller can tell "not there" (404, a definitive answer) from "broken" (a 5xx,
 * a 429), and the wait a rate-limited upstream asked for (`Retry-After`), so a
 * client can retry on the upstream's terms (task 15.1, BL-046). Still an
 * `IngestionError`: everything that handled the old error handles this.
 */
export class UpstreamError extends IngestionError {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number | undefined,
  ) {
    super(message)
  }
}

/** Split out so an adapter can refresh an expired token and try again. */
export class UnauthorizedError extends IngestionError {}

/**
 * A `Retry-After` header as a wait in milliseconds: a number of seconds, or an
 * HTTP date (the wait from `now`, never negative). Undefined when absent or
 * unreadable, so the caller falls back to its own backoff.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000

  // An HTTP date names its weekday and month; without letters `Date.parse` would
  // happily read "-3" as a year.
  if (!/[a-z]/i.test(trimmed)) return undefined

  const date = Date.parse(trimmed)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/**
 * Identifies this app to upstream APIs. MusicBrainz in particular *requires*
 * a meaningful User-Agent and will refuse generic ones — respecting each
 * source's terms is a stated boundary (SPEC.md §11), not a nicety.
 */
export const USER_AGENT = 'listulator/0.1.0 (https://github.com/gerharar/listulator)'

export interface GetOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  /** Named in error messages, so a failure says which service broke. */
  source: string
  fetchImpl?: FetchLike
  /** IGDB takes its queries as a POST body rather than a query string. */
  method?: 'GET' | 'POST'
  body?: string
}

export type GetJsonOptions = GetOptions

/** The `reason` of a Google-shaped error body, or undefined for anything else (another API, plain text, no body). */
async function googleReason(response: Response): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await response.text()) as { error?: { errors?: { reason?: unknown }[] } }
    const reason = parsed.error?.errors?.[0]?.reason

    return typeof reason === 'string' ? reason : undefined
  } catch {
    return undefined
  }
}

/**
 * Fetches with a timeout, the WebKit-User-Agent retry, and upstream
 * status-code handling shared by `getJson` and `getText` — everything up to
 * turning a successful response into a caller-shaped value, which is the one
 * thing that differs between an API that answers JSON and a raw file that
 * answers plain text (`getText`, task 7.4's canonical-repo fetch).
 */
async function fetchWithRetry(
  url: string,
  { headers = {}, timeoutMs = 15_000, source, fetchImpl = fetch, method = 'GET', body }: GetOptions,
  accept: string,
): Promise<Response> {
  async function attempt(withUserAgent: boolean): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetchImpl(url, {
        method,
        headers: {
          ...(withUserAgent ? { 'user-agent': USER_AGENT } : {}),
          accept,
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  let response: Response
  try {
    response = await attempt(true)
  } catch (cause) {
    // A browser's `fetch` refuses to let JS set `User-Agent` at all.
    // Chromium silently drops the header; WebKit (the standalone app's
    // macOS webview) throws synchronously instead, which otherwise looks
    // identical to a dead network (task 5.7's smoke test caught this on
    // Open Library, tested via a Chrome tab in task 5.3 and never seen
    // there). Retry once without it — a no-op for Node and the Tauri HTTP
    // plugin, which already succeeded on the first attempt. Not retried on
    // a timeout: a slow upstream will be slow again, and doubling the wait
    // teaches nothing.
    if (cause instanceof Error && cause.name === 'AbortError') {
      throw new IngestionError(`Could not reach ${source} (timed out).`)
    }

    try {
      response = await attempt(false)
    } catch (retryCause) {
      throw new IngestionError(
        `Could not reach ${source}${retryCause instanceof Error && retryCause.name === 'AbortError' ? ' (timed out)' : ''}.`,
      )
    }
  }

  if (response.status === 429) {
    throw new UpstreamError(
      `${source} is rate-limiting us. Try again in a moment.`,
      429,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }

  if (response.status === 403) {
    // Google's APIs (YouTube) use 403 for a spent quota and a rate limit as well as a refused key, and say which in
    // `error.errors[0].reason`. Read as bad credentials, a used-up daily quota tells the owner their key is wrong.
    const reason = await googleReason(response)

    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      throw new UpstreamError(`${source}'s daily quota is used up. It resets at midnight Pacific Time.`, 403)
    }

    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'concurrentLimitExceeded') {
      throw new UpstreamError(`${source} is rate-limiting us. Try again in a moment.`, 429)
    }

    throw new UnauthorizedError(`${source} rejected our credentials${reason ? ` (${reason})` : ''}.`)
  }

  if (response.status === 401) {
    throw new UnauthorizedError(`${source} rejected our credentials.`)
  }

  if (!response.ok) {
    // Upstream services explain themselves in the body, and a bare status code
    // sends whoever is debugging to the wrong place entirely. Not every
    // upstream answers JSON (a 404 from raw file hosting is plain text) —
    // that just falls through to the raw body via the inner catch.
    const detail = await response
      .text()
      .then((body) => {
        const parsed = JSON.parse(body) as { error?: { message?: string } }

        return parsed.error?.message ?? body
      })
      .catch(() => '')

    throw new UpstreamError(
      `${source} returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : '.'}`,
      response.status,
      parseRetryAfter(response.headers.get('retry-after')),
    )
  }

  return response
}

export async function getJson<T>(url: string, options: GetJsonOptions): Promise<T> {
  const response = await fetchWithRetry(url, options, 'application/json')

  try {
    return (await response.json()) as T
  } catch {
    throw new IngestionError(`${options.source} returned something that was not JSON.`)
  }
}

/** As `getJson`, for a plain-text response — a raw file, not an API. */
export async function getText(url: string, options: GetOptions): Promise<string> {
  const response = await fetchWithRetry(url, options, 'text/plain')
  return await response.text()
}

/** MusicBrainz asks for no more than one request per second. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A request is tried this many times in all. */
const MAX_ATTEMPTS = 3
/** The wait before a retry when the upstream names none: this, then double. */
const BACKOFF_MS = 500
/** A `Retry-After` longer than this is not waited out: the request fails and says so. */
const MAX_RETRY_WAIT_MS = 10_000

/**
 * Runs `attempt`, and tries it again when the upstream said "slow down" (429) or "I am broken" (a 5xx): up to
 * three tries in all, waiting what `Retry-After` names or 500 ms and then 1000 ms, and never longer than ten
 * seconds (a longer ask fails now, saying so). Anything else is an answer or will not mend in a second (a 400,
 * a 404, rejected credentials, an unreachable network) and passes through untouched. A listing that lost a page
 * to one glitch is worse than one that waited a second (15.1, BL-046).
 *
 * `attempt` should include any pacing of its own, so each retry takes its turn in the upstream's line.
 * `sleep` is injectable so the waits are testable without real waiting.
 */
export async function withRetries<T>(
  attempt: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = delay,
): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await attempt()
    } catch (error) {
      const retryable = error instanceof UpstreamError && (error.status === 429 || error.status >= 500)
      if (!retryable || tries >= MAX_ATTEMPTS) throw error

      const wait = error.retryAfterMs ?? BACKOFF_MS * 2 ** (tries - 1)
      if (wait > MAX_RETRY_WAIT_MS) throw error

      await sleep(wait)
    }
  }
}
