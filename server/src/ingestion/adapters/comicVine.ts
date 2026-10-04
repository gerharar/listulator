import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { delay, getJson, IngestionError, UnauthorizedError, withRetries, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter, SearchOptions, SearchPage } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

/**
 * Comic Vine: search a volume, expand to its issues.
 *
 * A "volume" is a run — Fantastic Four (1961), 416 issues — which is exactly
 * the unit someone sets out to finish.
 *
 * Their rate limit is far tighter than the other sources (roughly 200 requests
 * per resource per hour), so this reads issues in pages of 100 and never looks
 * up an issue individually. Issues therefore carry no real duration and fall
 * back to the category default; fetching page counts per issue would spend the
 * hourly budget on a single import. A count is one request (`count`), not a listing.
 */

const BASE = 'https://comicvine.gamespot.com/api'
/** Comic Vine throttles by velocity as well as by the hour, so requests are spaced like MusicBrainz's. */
const REQUEST_INTERVAL_MS = 1100
/** The API's own ceiling on `limit`: asked for 101 it answers 100 (live, 2026-10-04), so a bigger number buys nothing. */
const PAGE_SIZE = 100

/**
 * One line for the whole process, as TMDB's and IGDB's are: the desktop builds a new registry (so a new adapter)
 * whenever a setting changes, and a queue of its own per adapter would double the pace against one key that
 * is throttled by velocity.
 */
export const comicVineRequestLimiter: RateLimiter = createRateLimiter(REQUEST_INTERVAL_MS)

/** Rows the Search tab shows at a time, and so per "Show more". */
const SEARCH_PAGE_SIZE = 20
/**
 * How many of Comic Vine's own pages of a hundred matches one call looks at, at most. A query with thousands of
 * matches ("action comics": 3,452, half of them not named like it) must not chain requests to find twenty rows;
 * past this the call answers with what it found and no "more" (500 matches by Comic Vine's own relevance).
 */
const MAX_SEARCH_BATCHES = 5

interface VolumeResult {
  id: number
  name?: string
  start_year?: string | null
  count_of_issues?: number | null
  publisher?: { name?: string }
}

/**
 * Text as plain lowercase letters and digits: accents off, punctuation and spacing dropped, as IGDB's search folds
 * (BL-055), so "pacman" is in "Pac-Man (1980)" and "x men" in "X-Men". Third use of it: lift it into one place then.
 */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** The title a row shows: the name, then the year in brackets. A match is made against what the user reads. */
const titleOf = (volume: VolumeResult): string =>
  volume.start_year ? `${volume.name} (${volume.start_year})` : volume.name!

/**
 * Most issues first; a tie by name, then year (a volume with none last), then id, so the same answer always ranks
 * the same way and a later page can never reorder what an earlier one showed.
 */
function byIssueCount(a: VolumeResult, b: VolumeResult): number {
  return (
    (b.count_of_issues ?? 0) - (a.count_of_issues ?? 0) ||
    a.name!.localeCompare(b.name!) ||
    (a.start_year ?? '9999').localeCompare(b.start_year ?? '9999') ||
    a.id - b.id
  )
}

interface IssueResult {
  id: number
  issue_number?: string
  name?: string
  cover_date?: string
}

/** A volume's id when the ref is one (`volume:` and digits), the one test `expand` and `count` share. */
function volumeId(externalRef: string): string | undefined {
  const [kind, id] = externalRef.split(':')

  return kind === 'volume' && id && /^\d+$/.test(id) ? id : undefined
}

interface ComicVineResponse<T> {
  status_code?: number
  error?: string
  number_of_total_results?: number
  results?: T[]
}

/**
 * Issue numbers are strings upstream, and their own `sort=issue_number:asc`
 * orders them lexically — #1, #10, #100, #101 — which is not how anyone reads
 * a run. Sorted here instead: numerically where possible, with cover date as
 * the tiebreaker, and oddities like annuals last.
 */
function readingOrder(a: IssueResult, b: IssueResult): number {
  const left = Number(a.issue_number)
  const right = Number(b.issue_number)
  const leftOk = Number.isFinite(left)
  const rightOk = Number.isFinite(right)

  if (leftOk && rightOk && left !== right) return left - right
  if (leftOk !== rightOk) return leftOk ? -1 : 1

  return (a.cover_date ?? '9999').localeCompare(b.cover_date ?? '9999')
}

export interface ComicVineCredentials {
  apiKey?: string | undefined
}

/** Resolved per call, so `.env` load order cannot leave this holding nothing. */
export type ComicVineCredentialSource = ComicVineCredentials | (() => ComicVineCredentials)

export interface ComicVineClientOptions {
  /** Injectable so the waits are testable without real waiting. */
  sleep?: (ms: number) => Promise<void>
  /**
   * One line for every request this adapter makes, each retry and each count included (task 10.12, Q11).
   * Default: the shared `comicVineRequestLimiter` for the real Comic Vine, none for a fake `fetch` (a test is
   * not slowed by it).
   */
  limiter?: RateLimiter
}

export function createComicVineAdapter(
  credentials: ComicVineCredentialSource,
  fetchImpl?: FetchLike,
  { sleep = delay, limiter = fetchImpl ? undefined : comicVineRequestLimiter }: ComicVineClientOptions = {},
): SearchAdapter {
  const resolve = (): ComicVineCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  async function request<T>(path: string, params: Record<string, string>): Promise<ComicVineResponse<T>> {
    const { apiKey } = resolve()
    const search = new URLSearchParams({ api_key: apiKey ?? '', format: 'json', ...params })
    const send = () =>
      getJson<ComicVineResponse<T>>(`${BASE}${path}?${search.toString()}`, {
        source: 'Comic Vine',
        ...(fetchImpl ? { fetchImpl } : {}),
      })

    // A 429 or a 5xx is tried again, each try in the one line. A bad key is HTTP 401 (live) and not retried.
    const response = await withRetries(() => (limiter ? limiter.run(send) : send()), sleep)

    // Their own `status_code` (1 is OK; 100 invalid key, 101 not found, 102 URL format, 104 filter error) can
    // arrive in the body of a 200 too, so a failure is read from the payload as well as from the status. A typed
    // error, so the routes answer 502 and not 500.
    if (response.status_code !== undefined && response.status_code !== 1) {
      const message = `Comic Vine: ${response.error ?? 'request failed'}`
      throw response.status_code === 100 ? new UnauthorizedError(message) : new IngestionError(message)
    }

    return response
  }

  function toSource(volume: VolumeResult): ListSource {
    // "Fantastic Four" alone matches five different runs; the year, length and publisher are what tell them apart.
    const detail = [
      volume.start_year,
      volume.count_of_issues ? `${volume.count_of_issues} issues` : undefined,
      volume.publisher?.name,
    ]
      .filter(Boolean)
      .join(' · ')

    return {
      externalRef: `volume:${volume.id}`,
      title: titleOf(volume),
      ...(detail ? { detail } : {}),
      // The answer already says how many issues: the Search tab shows it and asks for no count of its own.
      ...(typeof volume.count_of_issues === 'number' ? { itemCount: volume.count_of_issues } : {}),
    }
  }

  /**
   * The Search tab's rows a page of twenty at a time, ranked by how many issues a run has (owner, 2026-10-04):
   * Comic Vine's own order puts one-issue oddities and fuzzy matches among the real runs, and a name like "action
   * comics" matches 3,452 volumes. Each hundred matches Comic Vine returns is filtered to the volumes whose title
   * contains the query and ranked by itself, and the hundreds are joined in the order they came, so a page
   * already shown is never reordered by the next. Stateless: a later page asks again from the first hundred
   * (Comic Vine's order is stable, checked), reading on only until it has one row past the page.
   */
  async function searchPage(query: string, options?: SearchOptions): Promise<SearchPage> {
    const needle = fold(query)
    if (!needle) return { sources: [] }

    const from = SEARCH_PAGE_SIZE * (Math.max(1, options?.page ?? 1) - 1)
    const ranked: VolumeResult[] = []
    let looked = 0
    let matches = 0

    for (let batch = 1; batch <= MAX_SEARCH_BATCHES; batch += 1) {
      const response = await request<VolumeResult>('/search/', {
        resources: 'volume',
        query,
        field_list: 'id,name,start_year,count_of_issues,publisher',
        limit: String(PAGE_SIZE),
        page: String(batch),
      })
      const found = response.results ?? []

      looked += found.length
      // No total in the answer: nothing is known beyond what came.
      matches = response.number_of_total_results ?? 0
      ranked.push(...found.filter((volume) => volume.name && fold(titleOf(volume)).includes(needle)).sort(byIssueCount))

      if (ranked.length > from + SEARCH_PAGE_SIZE || found.length < PAGE_SIZE || looked >= matches) break
    }

    return {
      sources: ranked.slice(from, from + SEARCH_PAGE_SIZE).map(toSource),
      ...(ranked.length > from + SEARCH_PAGE_SIZE ? { hasMore: true as const } : {}),
      total: ranked.length,
      ...(looked < matches ? { totalIsLowerBound: true as const } : {}),
    }
  }

  return {
    isAvailable: () => Boolean(resolve().apiKey),

    searchPage,

    async search(query) {
      return (await searchPage(query)).sources
    },

    // How many issues `expand` would list, from the total the API puts in every answer: one request, where
    // listing a run is one for every hundred issues (Action Comics, 864: 9). The Search tab counts every result
    // it shows and each request draws on the same hourly budget. Equal to the listing (864 and 864 live).
    count: async (externalRef) => {
      const id = volumeId(externalRef)
      if (!id) return undefined

      const response = await request<IssueResult>('/issues/', { filter: `volume:${id}`, field_list: 'id', limit: '1' })

      return response.number_of_total_results
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const id = volumeId(externalRef)
      if (!id) return []

      const issues: IssueResult[] = []

      // No cap of ours: the old 500 on an oldest-first listing dropped a run's newest issues (Action Comics,
      // 864: the newest 364). Paging stops at the end (the total, or a short page), or once past what a list
      // can hold, when the shared size check refuses the list and more pages would only spend the hour's budget.
      // Paged by `id`, which is unique, so a page can neither repeat nor skip an issue; reading order is made below.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const response = await request<IssueResult>('/issues/', {
          filter: `volume:${id}`,
          field_list: 'id,issue_number,name,cover_date',
          sort: 'id:asc',
          limit: String(PAGE_SIZE),
          offset: String(offset),
        })
        const batch = response.results ?? []

        issues.push(...batch)

        const total = response.number_of_total_results
        if (batch.length < PAGE_SIZE || issues.length > MAX_LIST_ITEMS || (total !== undefined && issues.length >= total)) break
      }

      return issues
        .sort(readingOrder)
        .map((issue): MediaTypeCandidate => {
          const number = issue.issue_number ? `#${issue.issue_number}` : ''
          const title = [number, issue.name].filter(Boolean).join(' ')

          return {
            title: title || `Issue ${issue.id}`,
            externalRef: `issue:${issue.id}`,
            // No duration: reading time would need a page count per issue,
            // which their rate limit cannot afford. The category default
            // (15 minutes) applies instead.
          }
        })
    }),
  }
}
