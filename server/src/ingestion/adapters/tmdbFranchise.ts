import type { FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'
import { createTmdbClient, episodeMinutes, type ShowRuntimeFields, type TmdbCredentialSource } from './tmdb.js'

/**
 * Cross-media franchises: everything under one TMDB keyword, films and
 * television together, in release order.
 *
 * The problem this solves is not "where does the data live" but "where does the
 * user look". A Marvel list split across Movies, TV and Animation leaves no
 * answer to "I'm watching What If…?, which shelf is my list on" — so the
 * franchise gets its own shelf, and one source fills it from both media.
 *
 * A keyword covers both `/discover/movie` and `/discover/tv`, and both carry
 * dates, which is what makes true release-order interleaving possible.
 */

const DOCUMENTARY_GENRE = 99
const MAX_PAGES = 5
const DETAIL_CONCURRENCY = 8

/**
 * Keyword coverage on TMDB varies enormously, so the ones known to be worth
 * offering are named here. Measured rather than assumed: Marvel returns 81
 * films and 36 series, Star Trek 13 and 7, while Star Wars manages only 8
 * films and Middle-earth 1 — those keywords are too sparsely applied to build
 * a list from, and searching finds the same thin keyword.
 */
export const CURATED_FRANCHISES: readonly { keywordId: number; title: string; detail: string }[] = [
  {
    keywordId: 180547,
    title: 'Marvel Cinematic Universe',
    detail: 'Films and series, in release order',
  },
  { keywordId: 327763, title: 'Star Trek', detail: 'Films and series, in release order' },
  {
    keywordId: 229266,
    title: 'DC Extended Universe',
    detail: 'Films and series, in release order',
  },
]

interface KeywordResult {
  id: number
  name?: string
}

interface DiscoverMovie {
  total_pages?: number
  results?: { id: number; title?: string; release_date?: string; genre_ids?: number[] }[]
}

interface DiscoverTv {
  total_pages?: number
  results?: { id: number; name?: string; first_air_date?: string; genre_ids?: number[] }[]
}

interface ShowDetail extends ShowRuntimeFields {
  seasons?: { season_number?: number; episode_count?: number; air_date?: string; name?: string }[]
}

interface SeasonDetail {
  episodes?: {
    episode_number?: number
    name?: string
    runtime?: number | null
    air_date?: string
  }[]
}

const pad = (value: number): string => String(value).padStart(2, '0')

interface DatedItem {
  date: string
  candidate: MediaTypeCandidate
}

export function createTmdbFranchiseAdapter(
  credentials: TmdbCredentialSource,
  fetchImpl?: FetchLike,
): SearchAdapter {
  const client = createTmdbClient(credentials, fetchImpl)

  async function carriesAnything(keywordId: number): Promise<boolean> {
    try {
      const counts = await Promise.all(
        ['/discover/movie', '/discover/tv'].map((path) =>
          client.request<{ total_results?: number }>(path, { with_keywords: String(keywordId) }),
        ),
      )
      return counts.some((count) => (count.total_results ?? 0) > 0)
    } catch {
      return true
    }
  }

  return {
    isAvailable: client.isConfigured,

    async search(query) {
      const term = query.trim().toLowerCase()
      // TMDB names keywords without the article: "The Witcher" is keyword "witcher" (F9).
      const bare = term.replace(/^(the|a|an)\s+/, '')

      const curated = CURATED_FRANCHISES.filter((franchise) =>
        franchise.title.toLowerCase().includes(term),
      ).map((franchise): ListSource => ({
        externalRef: `franchise:${franchise.keywordId}`,
        title: franchise.title,
        detail: franchise.detail,
      }))

      const response = await client.request<{ results?: KeywordResult[] }>('/search/keyword', {
        query,
      })

      const found = (response.results ?? [])
        .filter((keyword) => keyword.name)
        // TMDB's keyword search is fuzzy: "Marvel" comes back with marcel,
        // barrel, marret and market. Offered as "Franchise · films and
        // series" they are indistinguishable from the real thing, and every
        // one builds an empty list. Requiring the term to actually appear
        // costs nothing and drops all of them.
        .filter((keyword) => keyword.name!.toLowerCase().includes(bare))
        // Curated entries already cover these, with better names.
        .filter(
          (keyword) => !CURATED_FRANCHISES.some((franchise) => franchise.keywordId === keyword.id),
        )
        .slice(0, 6)

      // A keyword nothing carries builds an empty list that cannot be added
      // ("witcher" on TMDB, F9): one count per medium drops it. A count that
      // fails keeps the keyword, since offering too much beats hiding a real one.
      const carried = await Promise.all(found.map((keyword) => carriesAnything(keyword.id)))

      return [
        ...curated,
        ...found
          .filter((_, index) => carried[index])
          .map((keyword): ListSource => ({
            externalRef: `franchise:${keyword.id}`,
            title: keyword.name!,
            detail: 'Franchise · films and series',
          })),
      ]
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const [kind, id] = externalRef.split(':')
      if (kind !== 'franchise' || !id || !/^\d+$/.test(id)) return []

      const today = new Date().toISOString().slice(0, 10)

      const films: { id: number; title: string; date: string }[] = []
      const shows: { id: number; name: string }[] = []

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await client.request<DiscoverMovie>('/discover/movie', {
          with_keywords: id,
          sort_by: 'primary_release_date.asc',
          page: String(page),
        })

        for (const film of response.results ?? []) {
          // Behind-the-scenes documentaries are about the franchise rather
          // than part of it.
          if (!film.title || (film.genre_ids ?? []).includes(DOCUMENTARY_GENRE)) continue
          if (!film.release_date || film.release_date > today) continue
          films.push({ id: film.id, title: film.title, date: film.release_date })
        }

        if (page >= (response.total_pages ?? 1)) break
      }

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const response = await client.request<DiscoverTv>('/discover/tv', {
          with_keywords: id,
          sort_by: 'first_air_date.asc',
          page: String(page),
        })

        for (const show of response.results ?? []) {
          if (!show.name || (show.genre_ids ?? []).includes(DOCUMENTARY_GENRE)) continue
          shows.push({ id: show.id, name: show.name })
        }

        if (page >= (response.total_pages ?? 1)) break
      }

      // Films need a runtime each; shows need their season list, then one
      // request per aired season for its episodes (10.12b). Each stage is run
      // DETAIL_CONCURRENCY at a time, and the film stage and the episode stage
      // run side by side, so up to twice that many requests are in flight.
      const filmItems = client.mapLimited(
        films,
        DETAIL_CONCURRENCY,
        async (film): Promise<DatedItem> => {
          const runtime = await client
            .request<{ runtime?: number | null }>(`/movie/${film.id}`)
            .then((detail) => detail.runtime)
            .catch(() => null)

          return {
            date: film.date,
            candidate: {
              title: film.title,
              externalRef: `movie:${film.id}`,
              // Mega's Medium facet reads the category key a list file uses.
              tags: ['movie'],
              ...(runtime ? { timeToConsumeMinutes: runtime } : {}),
              year: Number(film.date.slice(0, 4)),
            },
          }
        },
      )

      const episodeItems = (async (): Promise<DatedItem[]> => {
        const details = await client.mapLimited(shows, DETAIL_CONCURRENCY, async (show) => ({
          show,
          detail: await client.request<ShowDetail>(`/tv/${show.id}`).catch((): ShowDetail => ({})),
        }))

        const seasons = details.flatMap(({ show, detail }) =>
          (detail.seasons ?? [])
            .filter((season) => (season.season_number ?? 0) > 0)
            .filter((season) => season.air_date && season.air_date <= today)
            .map((season) => ({
              show,
              number: season.season_number!,
              // The show's usual runtime, for episodes TMDB has no length for.
              perEpisode: episodeMinutes(detail),
            })),
        )

        const fetched = await client.mapLimited(seasons, DETAIL_CONCURRENCY, async (season) => ({
          ...season,
          detail: await client
            .request<SeasonDetail>(`/tv/${season.show.id}/season/${season.number}`)
            // One bad season costs that season, not the show.
            .catch((): SeasonDetail => ({})),
        }))

        return fetched.flatMap(({ show, number, perEpisode, detail }) =>
          (detail.episodes ?? [])
            // Unaired episodes cannot be watched, the same rule as unaired
            // seasons and unreleased films.
            .filter((episode) => episode.air_date && episode.air_date <= today)
            .map((episode): DatedItem => {
              const episodeNumber = episode.episode_number ?? 0
              const label = `S${pad(number)}E${pad(episodeNumber)}`
              const minutes = episode.runtime || perEpisode

              return {
                date: episode.air_date!,
                candidate: {
                  title: episode.name
                    ? `${show.name} ${label} ${episode.name}`
                    : `${show.name} ${label}`,
                  externalRef: `episode:${show.id}:${number}:${episodeNumber}`,
                  ...(minutes ? { timeToConsumeMinutes: minutes } : {}),
                  year: Number(episode.air_date!.slice(0, 4)),
                  group: `${show.name} — Season ${number}`,
                  tags: ['tv'],
                },
              }
            }),
        )
      })()

      // Release order across both media — the thing a franchise list is for,
      // and the reason this cannot be assembled by importing twice.
      return [...(await filmItems), ...(await episodeItems)]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((item) => item.candidate)
    }),
  }
}
