import type { FetchLike } from '../http.js'
import type { ListSource, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'
import {
  createTmdbClient,
  enrichMovieRuntimes,
  listFilms,
  TMDB_MAX_DISCOVER_PAGES,
  type TmdbCredentialSource,
} from './tmdb.js'

/**
 * TMDB companies: search a studio, expand to the films it made.
 *
 * "All Studio Ghibli films" is a studio, not a person or a collection — a
 * completionist unit the film adapter's shapes do not reach.
 */

/** TMDB's genre id for documentaries. */
const DOCUMENTARY_GENRE = 99
/** The pages after the first are asked for this many at a time. */
const PAGE_CONCURRENCY = 8

interface CompanyResult {
  id: number
  name?: string
  origin_country?: string
}

interface DiscoverResult {
  total_results?: number
  total_pages?: number
  results?: { id: number; title?: string; release_date?: string }[]
}

export interface TmdbCompanyOptions {
  /** Restricts to one genre, so the animation category stays animated. */
  genreFilter?: number
  /**
   * Whether a studio's list leaves documentaries out (the default): its films, not the documentaries about
   * making them, which belong to the Documentaries shelf (owner, 2026-10-03). A shelf that keeps to one
   * genre already says what belongs: Animation keeps `'include'`, so an animated short that TMDB also tags
   * as a documentary stays. The Documentaries shelf lists a studio's documentaries and nothing else
   * (`'only'`), the mirror of the rule above (BL-053).
   */
  documentaries?: 'exclude' | 'include' | 'only'
}

export function createTmdbCompanyAdapter(
  credentials: TmdbCredentialSource,
  { genreFilter, documentaries = 'exclude' }: TmdbCompanyOptions = {},
  fetchImpl?: FetchLike,
): SearchAdapter {
  const client = createTmdbClient(credentials, fetchImpl)

  const discover = (id: string, page: number) =>
    client.request<DiscoverResult>('/discover/movie', {
      with_companies: id,
      sort_by: 'primary_release_date.asc',
      page: String(page),
      // Genres are asked for together ("16,99" means both): a shelf's own genre and, for documentaries only, 99.
      ...(genreFilter || documentaries === 'only'
        ? { with_genres: [genreFilter, documentaries === 'only' ? DOCUMENTARY_GENRE : undefined].filter(Boolean).join(',') }
        : {}),
      // Asked of TMDB, not filtered here, so the pages and the count are exact.
      ...(documentaries === 'exclude' ? { without_genres: String(DOCUMENTARY_GENRE) } : {}),
    })

  /**
   * A shelf that keeps to one genre offers only a studio that has a released film of it (BL-052). The check is
   * the list's own first page, which is sorted oldest first, so an unreleased first film means nothing is out;
   * a check that fails keeps the studio: a network error must not hide a real one.
   */
  const scoped = Boolean(genreFilter) || documentaries === 'only'
  async function hasFilms(company: { id: number }): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10)

    try {
      return ((await discover(String(company.id), 1)).results ?? []).some(
        (film) => film.title && film.release_date && film.release_date <= today,
      )
    } catch {
      return true
    }
  }

  return {
    isAvailable: client.isConfigured,

    async search(query) {
      const response = await client.request<{ results?: CompanyResult[] }>('/search/company', {
        query,
      })

      const candidates = (response.results ?? []).filter((company) => company.name).slice(0, 5)
      const keep = scoped ? await Promise.all(candidates.map(hasFilms)) : candidates.map(() => true)

      return candidates
        .filter((_, index) => keep[index])
        .map(
          (company): ListSource => ({
            externalRef: `company:${company.id}`,
            title: `${company.name} — films`,
            detail: ['Studio', company.origin_country].filter(Boolean).join(' · '),
          }),
        )
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    enrich: (refs) => enrichMovieRuntimes(client, refs),
    enrichPrefixes: ['movie'],

    expand: itemsOnly(async (externalRef, options) => {
      const [kind, id] = externalRef.split(':')
      if (kind !== 'company' || !id || !/^\d+$/.test(id)) return []

      const today = new Date().toISOString().slice(0, 10)
      const films: { id: number; title: string; year?: number }[] = []

      const fetchPage = (page: number) => discover(id, page)

      // The first page says how many there are; the rest are asked for eight at a time, up to the last
      // page TMDB serves. Every page, in order: nothing is cut off at an arbitrary number.
      const first = await fetchPage(1)
      const lastPage = Math.min(first.total_pages ?? 1, TMDB_MAX_DISCOVER_PAGES)
      const rest = await client.mapLimited(
        Array.from({ length: Math.max(0, lastPage - 1) }, (_, index) => index + 2),
        PAGE_CONCURRENCY,
        fetchPage,
      )

      for (const response of [first, ...rest]) {
        for (const film of response.results ?? []) {
          // Released only, as everywhere else: a studio's announced slate is
          // not something anyone can finish watching.
          if (!film.title || !film.release_date || film.release_date > today) continue
          films.push({ id: film.id, title: film.title, year: Number(film.release_date.slice(0, 4)) })
        }
      }

      return listFilms(client, films, options)
    }),
  }
}
