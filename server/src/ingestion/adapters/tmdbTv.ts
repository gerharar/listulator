import type { FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { createTmdbClient, type TmdbCredentialSource } from './tmdb.js'

/**
 * TMDB television: search a show, expand to its episodes.
 *
 * A different shape from the film adapter, which searches people and
 * collections. Here the show *is* the source and the episodes are the items —
 * "watch all of Breaking Bad" is 62 episodes, not 62 searches.
 */

export const ANIMATION_GENRE = 16
export const DOCUMENTARY_GENRE = 99

/** A long-running show is genuinely long: The Simpsons is past 750 episodes. */
const MAX_ITEMS = 2000
const MAX_SEASONS = 60
/** Seasons are fetched one request each, a few at a time. */
const SEASON_CONCURRENCY = 5

interface ShowResult {
  id: number
  name?: string
  first_air_date?: string
  genre_ids?: number[]
  origin_country?: string[]
}

interface ShowDetail {
  name?: string
  seasons?: { season_number?: number; episode_count?: number }[]
}

interface SeasonDetail {
  episodes?: {
    episode_number?: number
    season_number?: number
    name?: string
    runtime?: number | null
    air_date?: string
  }[]
}

export interface TmdbTvOptions {
  /**
   * Restricts search results to one genre. Used for the animation category, so
   * searching there does not return live-action shows.
   */
  genreFilter?: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function createTmdbTvAdapter(
  credentials: TmdbCredentialSource,
  { genreFilter }: TmdbTvOptions = {},
  fetchImpl?: FetchLike,
): SearchAdapter {
  const { request, mapLimited, isConfigured } = createTmdbClient(credentials, fetchImpl)

  return {
    isAvailable: isConfigured,

    async search(query) {
      const response = await request<{ results?: ShowResult[] }>('/search/tv', { query })

      return (response.results ?? [])
        .filter((show) => show.name)
        .filter((show) => !genreFilter || (show.genre_ids ?? []).includes(genreFilter))
        .slice(0, 8)
        .map((show): ListSource => {
          // Shows share names across reboots and countries, so the year and
          // origin are what separate them.
          const detail = [show.first_air_date?.slice(0, 4), show.origin_country?.join('/')]
            .filter(Boolean)
            .join(' · ')

          return {
            externalRef: `show:${show.id}`,
            title: show.name!,
            ...(detail ? { detail } : {}),
          }
        })
    },

    async expand(externalRef) {
      const [kind, id] = externalRef.split(':')
      if (kind !== 'show' || !id || !/^\d+$/.test(id)) return []

      const show = await request<ShowDetail>(`/tv/${id}`)

      const seasons = (show.seasons ?? [])
        .map((season) => season.season_number)
        .filter((number): number is number => typeof number === 'number')
        // Specials (season 0) are included, and sorted to the end rather than
        // ahead of the pilot. People generally do watch them, and an unwanted
        // one is a click to delete where a missing one has to be typed back in
        // by hand.
        .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
        .slice(0, MAX_SEASONS)

      const fetched = await mapLimited(seasons, SEASON_CONCURRENCY, async (season) =>
        // One bad season should cost that season, not the whole show.
        request<SeasonDetail>(`/tv/${id}/season/${season}`).catch(() => ({ episodes: [] })),
      )

      const today = new Date().toISOString().slice(0, 10)
      const items: MediaTypeCandidate[] = []

      for (const season of fetched) {
        for (const episode of season.episodes ?? []) {
          // Unaired episodes cannot be watched, so they are not part of a list
          // you can finish — the same rule as unreleased films and games.
          if (!episode.air_date || episode.air_date > today) continue

          const seasonNumber = episode.season_number ?? 0
          const episodeNumber = episode.episode_number ?? 0
          const label = `S${pad(seasonNumber)}E${pad(episodeNumber)}`

          items.push({
            title: episode.name ? `${label} ${episode.name}` : label,
            ...(episode.runtime ? { timeToConsumeMinutes: episode.runtime } : {}),
          })
        }
      }

      return items.slice(0, MAX_ITEMS)
    },
  }
}
