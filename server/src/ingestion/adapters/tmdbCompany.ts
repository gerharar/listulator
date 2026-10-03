import type { FetchLike } from '../http.js'
import type { ListSource, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'
import { createTmdbClient, enrichMovieRuntimes, listFilms, type TmdbCredentialSource } from './tmdb.js'

/**
 * TMDB companies: search a studio, expand to the films it made.
 *
 * "All Studio Ghibli films" is a studio, not a person or a collection — a
 * completionist unit the film adapter's shapes do not reach.
 */

const MAX_PAGES = 5
const PAGE_SIZE = 20

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
}

export function createTmdbCompanyAdapter(
  credentials: TmdbCredentialSource,
  { genreFilter }: TmdbCompanyOptions = {},
  fetchImpl?: FetchLike,
): SearchAdapter {
  const client = createTmdbClient(credentials, fetchImpl)

  return {
    isAvailable: client.isConfigured,

    async search(query) {
      const response = await client.request<{ results?: CompanyResult[] }>('/search/company', {
        query,
      })

      return (response.results ?? [])
        .filter((company) => company.name)
        .slice(0, 5)
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

    expand: itemsOnly(async (externalRef, options) => {
      const [kind, id] = externalRef.split(':')
      if (kind !== 'company' || !id || !/^\d+$/.test(id)) return []

      const today = new Date().toISOString().slice(0, 10)
      const films: { id: number; title: string; year?: number }[] = []

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await client.request<DiscoverResult>('/discover/movie', {
          with_companies: id,
          sort_by: 'primary_release_date.asc',
          page: String(page),
          ...(genreFilter ? { with_genres: String(genreFilter) } : {}),
        })

        const batch = response.results ?? []

        for (const film of batch) {
          // Released only, as everywhere else: a studio's announced slate is
          // not something anyone can finish watching.
          if (!film.title || !film.release_date || film.release_date > today) continue
          films.push({ id: film.id, title: film.title, year: Number(film.release_date.slice(0, 4)) })
        }

        if (batch.length < PAGE_SIZE || page >= (response.total_pages ?? 1)) break
      }

      return listFilms(client, films, options)
    }),
  }
}
