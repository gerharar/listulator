import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { delay, getJson, IngestionError, withRetries, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import { ListTooLargeError } from '../expandSource.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter, SearchOptions, SearchPage } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

/**
 * MusicBrainz: search an artist, expand to their discography.
 *
 * No API key — the open database that makes "all of a band's albums" work
 * without anyone registering for anything.
 */

const BASE = 'https://musicbrainz.org/ws/2'
/** The most a page holds, in a browse and in a search alike. */
const PAGE_SIZE = 100
/** MusicBrainz asks for no more than one request per second; a little headroom on top. */
const REQUEST_INTERVAL_MS = 1100
/**
 * The line every MusicBrainz request waits in, for the whole process: the desktop builds its adapters again for
 * each request, and a line per adapter would be no line at all. A client given its own `fetch` (a test) gets none.
 */
export const musicBrainzRequestLimiter: RateLimiter = createRateLimiter(REQUEST_INTERVAL_MS)
/**
 * A search (of artists, of release groups) stops paging at offset 500: past it the answer is HTTP 400 (checked
 * live), whatever `count` says. A discography with more matches than this is read by browsing instead; an artist
 * search simply ends there.
 */
const SEARCH_WINDOW = 500
/** Artists a page of the Search tab shows, and what "Show more" adds: twenty, as Comic Vine's. */
const SEARCH_PAGE_SIZE = 20
/**
 * The most release groups a browse reads, matching or not (a browse cannot leave out a live album, so an artist's
 * whole catalogue is read to find the studio ones): a hundred pages, about two minutes at one request a second.
 */
const MAX_GROUPS_READ = MAX_LIST_ITEMS

interface ArtistSearchResponse {
  /** How many artists match, exactly (7,145 for "smith"), not how many the answer holds. */
  count?: number
  artists?: {
    id: string
    name: string
    type?: string
    country?: string
    disambiguation?: string
  }[]
}

interface ReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
}

/** A browse names its total `release-group-count`; a search names it `count`. */
interface ReleaseGroupResponse {
  'release-group-count'?: number
  count?: number
  'release-groups'?: ReleaseGroup[]
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

/**
 * The Lucene query that asks MusicBrainz's search for exactly the release groups the facets keep (see `keeps`):
 * studio albums (an album with no secondary type) always, an EP or a single when opted in, a live or compilation
 * release among the primary types asked for. Checked live against a browse with the same filter on one artist
 * with 977 albums: every facet alone and all four together gave the same set. The id is quoted and escaped, so
 * whatever it holds is a value and not more query.
 */
function discographyQuery(artistId: string, facets: Set<Facet> | null): string {
  const has = (facet: Facet) => facets?.has(facet) ?? false
  const primaries = ['album', ...(has('ep') ? ['ep'] : []), ...(has('single') ? ['single'] : [])].join(' OR ')
  const clauses = [
    '(primarytype:album AND NOT secondarytype:*)',
    ...(has('ep') ? ['primarytype:ep'] : []),
    ...(has('single') ? ['primarytype:single'] : []),
    ...(has('live') ? [`(primarytype:(${primaries}) AND secondarytype:live)`] : []),
    ...(has('compilation') ? [`(primarytype:(${primaries}) AND secondarytype:compilation)`] : []),
  ]

  return `arid:"${artistId.replace(/["\\]/g, '\\$&')}" AND (${clauses.join(' OR ')})`
}

/**
 * Studio albums always. A "discography" padded with compilations, live records and remix collections is not a
 * thing anyone sets out to complete by default (Cannibal Corpse returns 41 release groups, 16 of them albums;
 * Radiohead 386, 10 of them studio albums). EPs, singles, live releases and compilations are additive per-list
 * opt-ins on top of that baseline (see FACETS above); remixes, soundtracks and the rest stay excluded regardless.
 *
 * Note the corollary of asking for the primary types a facet needs: a "live single" only surfaces when *both*
 * "include singles" and "include live" are on. Documented in docs/DECISIONS.md.
 */
function keeps(group: ReleaseGroup, facets: Set<Facet> | null): boolean {
  const has = (facet: Facet) => facets?.has(facet) ?? false
  const primary = group['primary-type']
  const secondary = group['secondary-types'] ?? []
  const isStudioAlbum = primary === 'Album' && secondary.length === 0

  return (
    isStudioAlbum ||
    (has('ep') && primary === 'EP') ||
    (has('single') && primary === 'Single') ||
    (has('live') && secondary.includes('Live')) ||
    (has('compilation') && secondary.includes('Compilation'))
  )
}

export interface MusicBrainzClientOptions {
  /** Injectable so the waits between retries are testable without waiting. */
  sleep?: (ms: number) => Promise<void>
}

export function createMusicBrainzAdapter(
  fetchImpl?: FetchLike,
  /**
   * One line for every request this adapter makes: search, each page of an expansion, and the per-result counts
   * (task 10.12, Q11). Injectable so tests can watch it. By default the process-wide line; a client given its own
   * `fetch` (a test) gets none, as the other adapters.
   */
  limiter: RateLimiter | undefined = fetchImpl ? undefined : musicBrainzRequestLimiter,
  { sleep = delay }: MusicBrainzClientOptions = {},
): SearchAdapter {
  const options = { source: 'MusicBrainz', ...(fetchImpl ? { fetchImpl } : {}) }

  /**
   * One request, tried again when MusicBrainz says it is busy (a 503, which its search does now and then even
   * inside the one-a-second rule: seen live) or rate-limits us. Each try takes its turn in the line.
   */
  function request<T>(url: string): Promise<T> {
    return withRetries(() => (limiter ? limiter.run(() => getJson<T>(url, options)) : getJson<T>(url, options)), sleep)
  }

  const searchGroups = (artistId: string, facets: Set<Facet> | null, limit: number, offset: number) =>
    request<ReleaseGroupResponse>(
      `${BASE}/release-group?query=${encodeURIComponent(discographyQuery(artistId, facets))}` +
        `&fmt=json&limit=${limit}&offset=${offset}`,
    )

  /** Every release group of the primary types a facet needs, a page at a time, to a ceiling. */
  async function browseGroups(artistId: string, facets: Set<Facet> | null): Promise<ReleaseGroup[]> {
    // `type` filters by *primary* type server-side (verified live: a `type=album` request never returns a Single
    // or EP at all, though it still returns Live/Compilation *secondary* types alongside primary-type Album), so
    // EPs and singles must be asked for here, not just allowed through the client-side filter. Multiple types
    // combine with `|` (also verified live).
    const primaryTypes = ['album', ...(facets?.has('ep') ? ['ep'] : []), ...(facets?.has('single') ? ['single'] : [])]
    const typeParam = encodeURIComponent(primaryTypes.join('|'))
    const groups: ReleaseGroup[] = []

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const response = await request<ReleaseGroupResponse>(
        `${BASE}/release-group?artist=${encodeURIComponent(artistId)}` +
          `&type=${typeParam}&fmt=json&limit=${PAGE_SIZE}&offset=${offset}`,
      )

      const batch = response['release-groups'] ?? []
      groups.push(...batch)

      const total = response['release-group-count']
      if (total !== undefined && total > MAX_GROUPS_READ) {
        throw new IngestionError(
          `MusicBrainz holds ${total} releases of the chosen types for this artist, more than can be read (${MAX_GROUPS_READ}). Choose fewer release types.`,
        )
      }

      if (batch.length < PAGE_SIZE || (total !== undefined && groups.length >= total)) return groups
    }
  }

  async function searchPage(query: string, searchOptions?: SearchOptions): Promise<SearchPage> {
    const offset = SEARCH_PAGE_SIZE * (Math.max(1, searchOptions?.page ?? 1) - 1)
    // Past the window MusicBrainz answers 400, so the pages end there and a page beyond is empty without asking.
    if (offset >= SEARCH_WINDOW) return { sources: [] }

    const response = await request<ArtistSearchResponse>(
      `${BASE}/artist?query=${encodeURIComponent(query)}&fmt=json&limit=${SEARCH_PAGE_SIZE}&offset=${offset}`,
    )

    const artists = response.artists ?? []
    const reachable = Math.min(response.count ?? 0, SEARCH_WINDOW)

    return {
      sources: artists.map((artist): ListSource => ({
        externalRef: artist.id,
        // Every list this adapter builds is a discography (studio albums,
        // plus whichever release types the discography-type filters opt
        // into) — never a mixed or partial catalogue, so the name says so.
        title: `${artist.name} Discography`,
        ...(describe(artist) ? { detail: describe(artist) } : {}),
      })),
      ...(artists.length > 0 && offset + artists.length < reachable ? { hasMore: true as const } : {}),
      ...(response.count === undefined ? {} : { total: response.count }),
    }
  }

  return {
    // Needs no credentials, so it is always usable.
    isAvailable: () => true,

    // The search a page at a time (BL-063): up to twenty artists a page, with how many match. Always the same page
    // size, since a page of ten and a page of twenty are not slices of one order (checked live); the order is
    // stable for the same question.
    searchPage,

    async search(query) {
      return (await searchPage(query)).sources
    },

    // How many items `expand` would list, in one request: the search's own `count` of what the facets keep. A
    // listing is a page of a hundred for every hundred release groups the artist has of ANY type (Radiohead: 386
    // groups for 10 studio albums; Bach 6,101), and the Search tab counts every result it shows.
    count: async (externalRef) => {
      const { artistId, facets } = parseRef(externalRef)

      return (await searchGroups(artistId, facets, 1, 0)).count
    },

    // No `status`, deliberately (BL-013, task 10.11b). An artist's
    // `life-span.ended` was checked live and is not an honest "this
    // discography is complete": Prince gained studio albums in 2018 and 2021
    // after his death, Queen is flagged ended with no end date and still
    // tours, and The Beatles' flag sits beside releases dated after 1970.
    // It would also cost a second request per expansion at MusicBrainz's
    // 1-request-a-second limit. Revisit only with a different signal.
    expand: itemsOnly(async (externalRef) => {
      const { artistId, facets } = parseRef(externalRef)

      // The search says how many groups the facets keep and hands over the first hundred in the same answer:
      // one request for a typical discography, where a browse reads every group of the artist.
      const first = await searchGroups(artistId, facets, PAGE_SIZE, 0)
      const found = first['release-groups'] ?? []
      // No count: the page in hand is all there is.
      const total = first.count ?? 0
      if (total > MAX_LIST_ITEMS) throw new ListTooLargeError(total)

      let groups = found
      if (total > SEARCH_WINDOW) {
        // More than a search will page to: read the artist's groups and keep what the facets keep.
        groups = await browseGroups(artistId, facets)
      } else {
        for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) {
          const batch = (await searchGroups(artistId, facets, PAGE_SIZE, offset))['release-groups'] ?? []
          if (batch.length === 0) break
          groups = [...groups, ...batch]
        }
      }

      return (
        groups
          .filter((group) => keeps(group, facets))
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
