import { delay, getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

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

/**
 * Which non-studio-album release types a list should also include (task:
 * music discography type filters). Studio albums are always included; these
 * four are additive opt-ins on top of that baseline, additive with each
 * other too — a live EP shows up if either "include EPs" or "include live"
 * is on, not only when both are (confirmed with the user).
 */
const FACETS = ['ep', 'single', 'live', 'compilation'] as const
type Facet = (typeof FACETS)[number]

/**
 * The chosen facets travel folded into the *stored* `externalRef`
 * (`<artistId>:<facet>,<facet>,...`), the same technique the book-language
 * filter uses — so `/lists/:listId/refresh`, which just replays
 * `list.externalRef` through this same `expand()`, re-applies the same
 * choice automatically with no refresh-path changes. No colon at all (a
 * bare artist id — every list created before this feature, or manual entry)
 * means no facets: studio albums only, the original behaviour.
 */
/**
 * Per-item release-type facets for browsing a built list (task: per-item
 * release-type labels; generalized into `tags`, `docs/DECISIONS.md`) — the
 * primary type plus whichever of the two secondary facets this feature
 * cares about, e.g. `['Album']`, `['EP']`, `['Album', 'Live']`. Only
 * `Live`/`Compilation` are surfaced here, matching the two secondary
 * toggles above; any other secondary type MusicBrainz might carry (Remix,
 * Soundtrack, ...) is outside this feature's scope and stays unlabelled.
 */
function releaseTypeTags(group: {
  'primary-type'?: string
  'secondary-types'?: string[]
}): string[] {
  const extras = (group['secondary-types'] ?? []).filter(
    (type) => type === 'Live' || type === 'Compilation',
  )
  return [group['primary-type'] ?? 'Album', ...extras]
}

function parseRef(externalRef: string): { artistId: string; facets: Set<Facet> | null } {
  const sep = externalRef.indexOf(':')
  if (sep === -1) return { artistId: externalRef, facets: null }

  const facets = new Set(
    externalRef
      .slice(sep + 1)
      .split(',')
      .filter((entry): entry is Facet => (FACETS as readonly string[]).includes(entry)),
  )
  return { artistId: externalRef.slice(0, sep), facets }
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

      return (response.artists ?? []).map((artist): ListSource => ({
        externalRef: artist.id,
        // Every list this adapter builds is a discography (studio albums,
        // plus whichever release types the discography-type filters opt
        // into) — never a mixed or partial catalogue, so the name says so.
        title: `${artist.name} Discography`,
        ...(describe(artist) ? { detail: describe(artist) } : {}),
      }))
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      const { artistId, facets } = parseRef(externalRef)
      const includeEp = facets?.has('ep') ?? false
      const includeSingle = facets?.has('single') ?? false
      const includeLive = facets?.has('live') ?? false
      const includeCompilation = facets?.has('compilation') ?? false

      // `type` filters by *primary* type server-side (verified live: a
      // `type=album` request never returns a Single or EP at all, even
      // though the response still includes Live/Compilation *secondary*
      // types alongside primary-type Album) — so EPs/singles must be asked
      // for here, not just allowed through the client-side filter below.
      // Multiple types combine with `|` (also verified live).
      const primaryTypes = [
        'album',
        ...(includeEp ? ['ep'] : []),
        ...(includeSingle ? ['single'] : []),
      ]
      const typeParam = encodeURIComponent(primaryTypes.join('|'))

      const groups: NonNullable<ReleaseGroupResponse['release-groups']> = []

      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (page > 0) await delay(PAGE_DELAY_MS)

        const response = await getJson<ReleaseGroupResponse>(
          `${BASE}/release-group?artist=${encodeURIComponent(artistId)}` +
            `&type=${typeParam}&fmt=json&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          options,
        )

        const batch = response['release-groups'] ?? []
        groups.push(...batch)

        if (batch.length < PAGE_SIZE) break
      }

      return (
        groups
          /**
           * Studio albums always. A "discography" padded with compilations,
           * live records and remix collections is not a thing anyone sets out
           * to complete by default — and it matters: Cannibal Corpse returns
           * 41 release-groups, of which 16 are actual albums. EPs, singles,
           * live releases and compilations are additive per-list opt-ins on
           * top of that baseline (see FACETS above); remixes, soundtracks and
           * the rest stay excluded regardless — not asked for.
           *
           * Note the corollary of filtering `type` server-side above: a
           * "live single" only surfaces when *both* "include singles" and
           * "include live" are on, since a single-only request never even
           * fetches it otherwise. Documented in docs/DECISIONS.md.
           */
          .filter((group) => {
            const primary = group['primary-type']
            const secondary = group['secondary-types'] ?? []
            const isStudioAlbum = primary === 'Album' && secondary.length === 0

            return (
              isStudioAlbum ||
              (includeEp && primary === 'EP') ||
              (includeSingle && primary === 'Single') ||
              (includeLive && secondary.includes('Live')) ||
              (includeCompilation && secondary.includes('Compilation'))
            )
          })
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
            const tags = releaseTypeTags(group)

            return {
              title: group.title,
              externalRef: group.id,
              // Album length would need one extra request per album against a
              // one-per-second limit — minutes of waiting for a discography,
              // and abusive to a free service. The category default applies
              // instead, flagged estimated. See docs/DECISIONS.md.
              ...(Number.isInteger(year) && year > 0 ? { year } : {}),
              tags,
            }
          })
      )
    }),
  }
}
