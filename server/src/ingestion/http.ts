/** Anything `fetch`-shaped, so adapters can be tested without real network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export class IngestionError extends Error {}

/** Split out so an adapter can refresh an expired token and try again. */
export class UnauthorizedError extends IngestionError {}

/**
 * Identifies this app to upstream APIs. MusicBrainz in particular *requires*
 * a meaningful User-Agent and will refuse generic ones — respecting each
 * source's terms is a stated boundary (SPEC.md §11), not a nicety.
 */
export const USER_AGENT = 'listulator/0.1.0 (https://github.com/neuroshaoh/listulator)'

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
    throw new IngestionError(`${source} is rate-limiting us. Try again in a moment.`)
  }

  if (response.status === 401 || response.status === 403) {
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

    throw new IngestionError(
      `${source} returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : '.'}`,
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
