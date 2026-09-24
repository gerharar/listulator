import { getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
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
 * hourly budget on a single import.
 */

const BASE = 'https://comicvine.gamespot.com/api'
const PAGE_SIZE = 100
/** Long runs are genuinely long: Fantastic Four (1961) is 416 issues. */
const MAX_ITEMS = 500
const MAX_PAGES = 5

interface VolumeResult {
  id: number
  name?: string
  start_year?: string
  count_of_issues?: number
  publisher?: { name?: string }
}

interface IssueResult {
  id: number
  issue_number?: string
  name?: string
  cover_date?: string
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

export function createComicVineAdapter(
  credentials: ComicVineCredentialSource,
  fetchImpl?: FetchLike,
): SearchAdapter {
  const resolve = (): ComicVineCredentials =>
    typeof credentials === 'function' ? credentials() : credentials

  async function request<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const { apiKey } = resolve()
    const search = new URLSearchParams({ api_key: apiKey ?? '', format: 'json', ...params })

    const response = await getJson<ComicVineResponse<T>>(`${BASE}${path}?${search.toString()}`, {
      source: 'Comic Vine',
      ...(fetchImpl ? { fetchImpl } : {}),
    })

    // Comic Vine answers 200 with an error in the body, including for a bad
    // key — so a failure has to be read from the payload, not the status.
    if (response.status_code !== undefined && response.status_code !== 1) {
      throw new Error(`Comic Vine: ${response.error ?? 'request failed'}`)
    }

    return response.results ?? []
  }

  return {
    isAvailable: () => Boolean(resolve().apiKey),

    async search(query) {
      const volumes = await request<VolumeResult>('/search/', {
        resources: 'volume',
        query,
        field_list: 'id,name,start_year,count_of_issues,publisher',
        limit: '8',
      })

      return volumes
        .filter((volume) => volume.name)
        .map((volume): ListSource => {
          // "Fantastic Four" alone matches five different runs; the year,
          // length and publisher are what tell them apart.
          const detail = [
            volume.start_year,
            volume.count_of_issues ? `${volume.count_of_issues} issues` : undefined,
            volume.publisher?.name,
          ]
            .filter(Boolean)
            .join(' · ')

          return {
            externalRef: `volume:${volume.id}`,
            title: volume.start_year ? `${volume.name} (${volume.start_year})` : volume.name!,
            ...(detail ? { detail } : {}),
          }
        })
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const [kind, id] = externalRef.split(':')
      if (kind !== 'volume' || !id || !/^\d+$/.test(id)) return []

      const issues: IssueResult[] = []

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch = await request<IssueResult>('/issues/', {
          filter: `volume:${id}`,
          field_list: 'id,issue_number,name,cover_date',
          sort: 'cover_date:asc',
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        })

        issues.push(...batch)

        if (batch.length < PAGE_SIZE || issues.length >= MAX_ITEMS) break
      }

      return issues
        .sort(readingOrder)
        .slice(0, MAX_ITEMS)
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
