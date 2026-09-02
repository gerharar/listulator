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
export const USER_AGENT = 'duldulator/0.1.0 (https://github.com/neuroshaoh/duldulator)'

export interface GetJsonOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  /** Named in error messages, so a failure says which service broke. */
  source: string
  fetchImpl?: FetchLike
  /** IGDB takes its queries as a POST body rather than a query string. */
  method?: 'GET' | 'POST'
  body?: string
}

export async function getJson<T>(
  url: string,
  {
    headers = {},
    timeoutMs = 15_000,
    source,
    fetchImpl = fetch,
    method = 'GET',
    body,
  }: GetJsonOptions,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
      signal: controller.signal,
    })
  } catch (cause) {
    // A dead network and a slow upstream look the same to the user, and
    // neither is their fault — say which service, not which exception.
    throw new IngestionError(
      `Could not reach ${source}${cause instanceof Error && cause.name === 'AbortError' ? ' (timed out)' : ''}.`,
    )
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 429) {
    throw new IngestionError(`${source} is rate-limiting us. Try again in a moment.`)
  }

  if (response.status === 401 || response.status === 403) {
    throw new UnauthorizedError(`${source} rejected our credentials.`)
  }

  if (!response.ok) {
    throw new IngestionError(`${source} returned ${response.status}.`)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new IngestionError(`${source} returned something that was not JSON.`)
  }
}

/** MusicBrainz asks for no more than one request per second. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
