import { delay, getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'

/**
 * MusicBrainz: search an artist, expand to their discography.
 *
 * No API key — the open database that makes "all of a band's albums" work
 * without anyone registering for anything.
 */

const BASE = 'https://musicbrainz.org/ws/2'
const PAGE_SIZE = 100
/** Their guideline is one request per second for anonymous clients. */
const PAGE_DELAY_MS = 1100
/** Bounded so a pathological artist cannot hold a request open forever. */
const MAX_PAGES = 5

interface ArtistSearchResponse {
  artists?: {
    id: string
    name: string
    type?: string
    country?: string
    disambiguation?: string
  }[]
}

interface ReleaseGroupResponse {
  'release-group-count'?: number
  'release-groups'?: {
    id: string
    title: string
    'first-release-date'?: string
    'primary-type'?: string
    'secondary-types'?: string[]
  }[]
}

function describe(artist: NonNullable<ArtistSearchResponse['artists']>[number]): string {
  return [artist.type, artist.country, artist.disambiguation].filter(Boolean).join(' · ')
}

export function createMusicBrainzAdapter(fetchImpl?: FetchLike): SearchAdapter {
  const options = { source: 'MusicBrainz', ...(fetchImpl ? { fetchImpl } : {}) }

  return {
    // Needs no credentials, so it is always usable.
    isAvailable: () => true,

    async search(query) {
      const response = await getJson<ArtistSearchResponse>(
        `${BASE}/artist?query=${encodeURIComponent(query)}&fmt=json&limit=10`,
        options,
      )

      return (response.artists ?? []).map(
        (artist): ListSource => ({
          externalRef: artist.id,
          title: artist.name,
          ...(describe(artist) ? { detail: describe(artist) } : {}),
        }),
      )
    },

    async expand(externalRef) {
      const groups: NonNullable<ReleaseGroupResponse['release-groups']> = []

      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (page > 0) await delay(PAGE_DELAY_MS)

        const response = await getJson<ReleaseGroupResponse>(
          `${BASE}/release-group?artist=${encodeURIComponent(externalRef)}` +
            `&type=album&fmt=json&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          options,
        )

        const batch = response['release-groups'] ?? []
        groups.push(...batch)

        if (batch.length < PAGE_SIZE) break
      }

      return (
        groups
          /**
           * Studio albums only. A "discography" padded with compilations,
           * live records and remix collections is not a thing anyone sets out
           * to complete — and it matters: Cannibal Corpse returns 41
           * release-groups, of which 16 are actual albums.
           */
          .filter(
            (group) =>
              group['primary-type'] === 'Album' && (group['secondary-types'] ?? []).length === 0,
          )
          // Chronological, which is how a discography is listened through.
          // Dates can be partial ("1994-03") or missing; string comparison
          // orders ISO prefixes correctly and puts undated releases last.
          .sort((a, b) =>
            (a['first-release-date'] ?? '9999').localeCompare(b['first-release-date'] ?? '9999'),
          )
          .map((group): MediaTypeCandidate => {
            // Dates can be partial ("1994-03") or missing; only a real
            // 4-digit year prefix counts, never a guess.
            const year = Number(group['first-release-date']?.slice(0, 4))

            return {
              title: group.title,
              externalRef: group.id,
              // Album length would need one extra request per album against a
              // one-per-second limit — minutes of waiting for a discography,
              // and abusive to a free service. The category default applies
              // instead, flagged estimated. See docs/DECISIONS.md.
              ...(Number.isInteger(year) && year > 0 ? { year } : {}),
            }
          })
      )
    },
  }
}
