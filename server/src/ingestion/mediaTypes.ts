import { createComicVineAdapter } from './adapters/comicVine.js'
import { createIgdbAdapter } from './adapters/igdb.js'
import { createMusicBrainzAdapter } from './adapters/musicbrainz.js'
import { createYouTubeAdapter } from './adapters/youtube.js'
import {
  createWikipediaEventsAdapter,
  MMA_PROMOTIONS,
  UFC_SUB_SERIES,
  WRESTLING_PROMOTIONS,
  WWE_SUB_SERIES,
} from './adapters/wikipediaEvents.js'
import { createOpenLibraryAdapter } from './adapters/openLibrary.js'
import { createCompositeAdapter } from './adapters/composite.js'
import { createTmdbAdapter } from './adapters/tmdb.js'
import { createTmdbCompanyAdapter } from './adapters/tmdbCompany.js'
import { ANIMATION_GENRE, DOCUMENTARY_GENRE, createTmdbTvAdapter } from './adapters/tmdbTv.js'
import type { ListStatus } from '../db/schema.js'
import type { FacetConvention } from '../catalog/facets.js'
import type { FetchLike } from './http.js'
import type { TmdbCredentialSource } from './adapters/tmdb.js'
import type { IgdbCredentialSource } from './adapters/igdb.js'
import type { ComicVineCredentialSource } from './adapters/comicVine.js'
import type { YouTubeCredentialSource } from './adapters/youtube.js'

/**
 * Credential and fetch overrides for the standalone (Tauri) app, which has
 * no `.env` and — per task 5.3's CORS findings — must route three providers
 * (IGDB's data endpoints, Comic Vine, MusicBrainz) through the Tauri HTTP
 * plugin instead of the webview's own `fetch`. The server passes neither and
 * gets the original `process.env`-backed, direct-fetch behaviour untouched.
 */
export interface MediaTypeOverrides {
  credentials?: {
    tmdb?: TmdbCredentialSource
    igdb?: IgdbCredentialSource
    comicVine?: ComicVineCredentialSource
    youtube?: YouTubeCredentialSource
  }
  fetchImpl?: {
    igdb?: FetchLike
    comicVine?: FetchLike
    musicbrainz?: FetchLike
  }
}

/**
 * Builds the built-in media categories. A factory rather than module-level
 * consts so the standalone app can supply its own credentials (Tauri's store
 * plugin, not `process.env`) and route specific providers through the Tauri
 * HTTP plugin — see `MediaTypeOverrides`.
 *
 * Credentials are still read per call rather than captured eagerly: on the
 * server this module is evaluated during import, before the entry point
 * loads `.env`. Adapters report themselves unavailable when their
 * credentials are missing, so an unkeyed install simply has no search for
 * that category.
 */
export function createDefaultMediaTypes({
  credentials = {},
  fetchImpl = {},
}: MediaTypeOverrides = {}): readonly MediaType[] {
  const tmdbCredentials =
    credentials.tmdb ??
    (() => ({
      apiKey: process.env['TMDB_API_KEY'],
      readAccessToken: process.env['TMDB_READ_ACCESS_TOKEN'],
    }))

  /**
   * Several categories draw on more than one shape of TMDB search, because a
   * medium is not a search shape. Animation holds both Naruto (a series) and
   * Studio Ghibli (a studio of films); documentaries hold both series and a
   * director's body of work. Each category still picks its own sources —
   * there is no cross-cutting "TMDB" category (docs/DECISIONS.md).
   */
  const films = createTmdbAdapter(tmdbCredentials)
  const studios = createTmdbCompanyAdapter(tmdbCredentials)

  const animatedShows = createTmdbTvAdapter(tmdbCredentials, { genreFilter: ANIMATION_GENRE })
  const animationStudios = createTmdbCompanyAdapter(tmdbCredentials, {
    genreFilter: ANIMATION_GENRE,
    // The genre already keeps it animated; an animated short that is also tagged a documentary stays.
    documentaries: 'include',
  })

  // Animation also holds a collection of animated films (Toy Story) and a person's animated films: voiced or
  // directed (BL-051, owner: cast and directing), animated only. The person's credits take the same
  // "Self"/archive-footage rule as Movies (BL-045), through the same adapter.
  const animationFilms = createTmdbAdapter(tmdbCredentials, {
    kinds: ['collection', 'person'],
    genreFilter: ANIMATION_GENRE,
    includeDirecting: true,
    documentaries: 'include',
  })

  const documentarySeries = createTmdbTvAdapter(tmdbCredentials, {
    genreFilter: DOCUMENTARY_GENRE,
  })
  // A studio's documentaries (the making-of films Movies leaves out), and only those.
  const documentaryStudios = createTmdbCompanyAdapter(tmdbCredentials, { documentaries: 'only' })
  const documentaryFilms = createTmdbAdapter(tmdbCredentials, {
    documentaries: 'only',
    // Documentarians direct rather than appear; cast credits alone found 12 of
    // Ken Burns' 59 documentaries.
    includeDirecting: true,
  })

  const tmdbTv = createTmdbTvAdapter(tmdbCredentials)

  /** Films by a person or collection, plus films by a studio. */
  const movieSources = createCompositeAdapter([
    { prefixes: ['person', 'collection'], enrichPrefixes: ['movie'], adapter: films },
    { prefixes: ['company'], enrichPrefixes: ['movie'], adapter: studios },
  ])

  /** Animated series, the studios that make animated films, and collections of animated films. */
  const animationSources = createCompositeAdapter([
    { prefixes: ['show'], tag: 'tv', adapter: animatedShows },
    { prefixes: ['company'], enrichPrefixes: ['movie'], tag: 'movie', adapter: animationStudios },
    { prefixes: ['collection', 'person'], enrichPrefixes: ['movie'], tag: 'movie', adapter: animationFilms },
  ])

  /** Documentary series, a film-maker's documentaries, and a studio's documentaries. */
  const documentarySources = createCompositeAdapter([
    { prefixes: ['show'], adapter: documentarySeries },
    { prefixes: ['person', 'collection'], enrichPrefixes: ['movie'], adapter: documentaryFilms },
    { prefixes: ['company'], enrichPrefixes: ['movie'], adapter: documentaryStudios },
  ])

  const igdb = createIgdbAdapter(
    credentials.igdb ??
      (() => ({
        clientId: process.env['IGDB_CLIENT_ID'],
        clientSecret: process.env['IGDB_CLIENT_SECRET'],
      })),
    fetchImpl.igdb,
  )

  const comicVine = createComicVineAdapter(
    credentials.comicVine ?? (() => ({ apiKey: process.env['COMIC_VINE_API_KEY'] })),
    fetchImpl.comicVine,
  )

  return [
    {
      key: 'movie',
      label: 'Movies',
      sortOrder: 10,
      defaultDurationMinutes: 120,
      adapter: movieSources,
      sourceName: 'TMDB',
      sourceCopyMaxDays: 180,
    },
    {
      key: 'tv',
      label: 'TV Shows',
      sortOrder: 20,
      defaultDurationMinutes: 50,
      adapter: tmdbTv,
      sourceName: 'TMDB',
      sourceCopyMaxDays: 180,
    },
    // Episode-length. The category also holds animated features, which this
    // badly under-estimates — flagged estimated and easy to correct per item.
    {
      key: 'animation',
      label: 'Animation',
      sortOrder: 30,
      defaultDurationMinutes: 25,
      adapter: animationSources,
      sourceName: 'TMDB',
      sourceCopyMaxDays: 180,
      // A Ghost in the Shell film and its series share this list; Movie/TV tells them apart.
      facets: [{ key: 'type', label: 'Type', values: ['Movie', 'TV'] }],
    },
    // Feature-length is the common case for a documentary; series episodes run
    // shorter and are corrected per item.
    {
      key: 'documentary',
      label: 'Documentaries',
      sortOrder: 35,
      defaultDurationMinutes: 90,
      adapter: documentarySources,
      sourceName: 'TMDB',
      sourceCopyMaxDays: 180,
    },
    {
      key: 'wrestling',
      label: 'Wrestling',
      sortOrder: 40,
      defaultDurationMinutes: 180,
      adapter: createWikipediaEventsAdapter(WRESTLING_PROMOTIONS, undefined, WWE_SUB_SERIES),
      sourceName: 'Wikipedia',
    },
    {
      key: 'mma',
      label: 'MMA',
      sortOrder: 50,
      defaultDurationMinutes: 180,
      adapter: createWikipediaEventsAdapter(MMA_PROMOTIONS, undefined, UFC_SUB_SERIES),
      sourceName: 'Wikipedia',
    },
    // Time-to-beat for a mainline game, not a completionist run.
    {
      key: 'game',
      label: 'Games',
      sortOrder: 60,
      defaultDurationMinutes: 600,
      adapter: igdb,
      sourceName: 'IGDB',
      // A game can be different content on each platform, so tags carry platform codes.
      facets: [{ key: 'platform', label: 'Platform' }],
    },
    // ~15 min for a standard 30-page issue (SPEC.md §5). Comic Vine's rate
    // limit rules out fetching a real page count per issue.
    {
      key: 'comic',
      label: 'Comics',
      sortOrder: 70,
      defaultDurationMinutes: 15,
      adapter: comicVine,
      sourceName: 'Comic Vine',
    },
    {
      key: 'book',
      label: 'Books',
      sortOrder: 80,
      defaultDurationMinutes: 240,
      adapter: createOpenLibraryAdapter(),
      sourceName: 'Open Library',
      facets: [{ key: 'language', label: 'Language', noValue: ['Unknown'] }],
    },
    {
      key: 'music',
      label: 'Music',
      sortOrder: 90,
      defaultDurationMinutes: 45,
      adapter: createMusicBrainzAdapter(fetchImpl.musicbrainz),
      sourceName: 'MusicBrainz',
      // One Type (owner, 2026-09-27): Mini covers EP and Single, kept as the source wrote them;
      // a Compilation is that before its size. Live rides on top, filtered as its own facet.
      facets: [
        {
          key: 'type',
          label: 'Type',
          keepOrder: true,
          prevails: 'Compilation',
          values: [
            'Album',
            { tag: 'Mini', label: 'Mini', aliases: ['EP', 'Single'] },
            // Comp on the row's 58px chip only; Compilation in filters and pickers (owner). Stored as sources write it.
            { tag: 'Compilation', label: 'Compilation', short: 'Comp', aliases: ['Comp'] },
          ],
        },
        { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
      ],
    },
    // Lengths vary from three minutes to three hours, so this default is more
    // placeholder than estimate — real durations come from the API.
    {
      key: 'youtube',
      label: 'YouTube',
      sortOrder: 95,
      defaultDurationMinutes: 20,
      adapter: createYouTubeAdapter(
        credentials.youtube ?? (() => ({ apiKey: process.env['YOUTUBE_API_KEY'] })),
      ),
      sourceName: 'YouTube',
      sourceCopyMaxDays: 30,
    },
    /**
     * The shelf for franchises that genuinely span media. Its existence is a
     * navigation answer more than a data one: a Marvel list split across
     * Movies, TV and Animation leaves nowhere obvious to look.
     *
     * Curated lists only, and **no adapter and no source name** (owner, 2026-10-03): nothing here ever
     * looks anything up in TMDB or any connector, so no connector's limits, retries or lookups can touch
     * it. Users search the community library (`searchScope: 'library'`); a list is a library list or a
     * file, never fetched. The TMDB franchise adapter that once stood behind this entry is deleted.
     */
    {
      key: 'mega',
      label: 'Mega',
      description:
        'For franchise lists that span multiple media types (films, series, games, and so on)',
      sortOrder: 100,
      // Mixed by nature; real runtimes come from the API.
      defaultDurationMinutes: 120,
      // Users search curated lists only, and the list generator refuses Mega (TMDB data cannot go into lists/).
      searchScope: 'library',
      // A Mega item's medium is one of the other categories, tagged with the key a list file
      // uses (`tags: [game]`); the label is only for display.
      facets: [
        {
          key: 'type',
          label: 'Medium',
          values: [
            { tag: 'movie', label: 'Movie' },
            { tag: 'tv', label: 'TV' },
            { tag: 'animation', label: 'Animation' },
            { tag: 'documentary', label: 'Documentary' },
            { tag: 'wrestling', label: 'Wrestling' },
            { tag: 'mma', label: 'MMA' },
            { tag: 'game', label: 'Game' },
            { tag: 'comic', label: 'Comic' },
            { tag: 'book', label: 'Book' },
            { tag: 'music', label: 'Music' },
            { tag: 'youtube', label: 'YouTube' },
          ],
        },
      ],
    },
  ]
}

/**
 * The built-in media categories.
 *
 * Open in code, closed to users (SPEC.md §5): adding a category is one entry
 * here — no migration, no changes to `catalog` or `suggestions` — but users
 * cannot invent one through the app. That is what stops buckets fragmenting
 * into `tv` / `TV` / `Television`, and what makes "show every category" a
 * well-defined thing for the UI to render.
 */

export interface MediaTypeCandidate {
  title: string
  /** Upstream id, so a later refresh can match what it already imported. */
  externalRef?: string
  /** Only when the source actually knows it; otherwise the category default applies. */
  timeToConsumeMinutes?: number
  /**
   * A better guess than the category's default for what this item lasts, set only when the source has no length
   * and knows the kind of thing it is (an IGDB DLC). The item is still estimated: `timeToConsumeMinutes` stays
   * unset and every import takes this in place of the category default.
   */
  estimatedMinutes?: number
  /** Only when the source actually knows it — never guessed from another field. */
  year?: number
  /** Optional grouping label, e.g. "Season 1" — presentation only (task 6.6). */
  group?: string
  /**
   * Generic per-item display tags (SPEC.md §4) — a release type, a
   * language, a medium, or whatever else a source or a canonical-list YAML
   * file provides. One field for every category.
   */
  tags?: string[]
  /**
   * Curator-authored disambiguation prose, capped at 2048 characters. Only
   * a canonical/file-imported YAML sets this (Phase 10, task 10.2c) — no
   * adapter populates it this phase.
   */
  notes?: string
}

/**
 * Something upstream that can become a whole list: an artist, a filmography,
 * a franchise, a comic volume.
 */
export interface ListSource {
  /** Upstream id, passed back to `expand`. */
  externalRef: string
  /** Suggested list title. */
  title: string
  /** Disambiguation, since searches return near-identical names. */
  detail?: string
  /**
   * How many items the source holds, when the search answer already says so (Comic Vine's `count_of_issues`):
   * the Search tab shows it without asking `expansion` for a count. Absent: it asks, as it always did.
   */
  itemCount?: number
}

/**
 * Search and metadata lookup for a category.
 *
 * Two steps on purpose. This app is about *lists*, so the useful search is
 * "find me something that becomes a list" — you look up Jackie Chan and get
 * the filmography, rather than searching for one film at a time and repeating
 * it ninety-nine times. `search` finds the sources; `expand` turns the chosen
 * one into its items.
 *
 * A category may have no adapter at all (wrestling and MMA have no usable
 * public API). Manual entry always works regardless, so it is the baseline
 * rather than an adapter of its own.
 */
/**
 * Book-category-only search modifiers (the GUI's language picker) — every
 * other adapter's `search` ignores this second parameter entirely, which is
 * a valid implementation of the interface below without changing any of
 * them.
 */
export interface SearchOptions {
  /** ISO 639-2 (bibliographic) code, or `'all'`/absent for no filter. */
  language?: string
  /** Also count/keep works with no language tag, widening a strict filter. */
  includeUnknown?: boolean
  /** Which page of results, from 1 (absent is 1): the Search tab's "Show more". Only an adapter with `searchPage` has a second. */
  page?: number
}

/**
 * One page of an adapter's search, for a source with more matches than one page shows. `hasMore` is only ever
 * true (absent means this is the last page); `total` is how many matches the adapter has found so far, and
 * `totalIsLowerBound` says it has not looked at them all, so the real number may be higher.
 */
export interface SearchPage {
  sources: ListSource[]
  hasMore?: true
  total?: number
  totalIsLowerBound?: true
}

/**
 * What `expand()` yields for one source: its items, plus — only when the
 * upstream genuinely says so — the production status of the thing the list is
 * about. One call yields both, so a search result's count and status cost one
 * request (task 10.11b, BL-013). Absent means unknown, never a guess.
 */
export interface ListExpansion {
  items: MediaTypeCandidate[]
  status?: ListStatus
}

/**
 * How `expand()` treats the per-item lookups that cost a request each (task 15.2).
 *
 * `'inline'` (the default, and what every caller got before) fills every item's
 * length during the expansion. `'skip'` lists the items only: an item whose
 * length needs its own request comes back without `timeToConsumeMinutes`, and
 * `enrich` fetches those afterwards, so a big list can be built at once and its
 * lengths filled in later. An adapter with no such lookup (its lengths arrive
 * with the listing, or it has none) ignores the option.
 */
export interface ExpandOptions {
  runtimes?: 'inline' | 'skip'
}

/**
 * What `enrich()` found for one ref. `none` is a definitive answer (the source
 * has no length for it: a 404, a zero), to be stored as such and not asked
 * again; `failed` is not (the request did not get through), so the item stays
 * pending and the caller tries it later.
 */
export type RuntimeLookup =
  | { status: 'found'; minutes: number }
  | { status: 'none' }
  | { status: 'failed'; error: unknown }

export interface SearchAdapter {
  /** False when, say, an API key is missing — the UI hides search for it. */
  isAvailable(): boolean
  search(query: string, options?: SearchOptions): Promise<ListSource[]>
  /**
   * The same search a page at a time, with how many matches there are: the Search tab's "Show more" (Comic Vine
   * matches thousands, and shows twenty at once). `options.page` is the page wanted, from 1. Absent: the adapter's
   * `search` is everything it offers and there is no second page.
   */
  searchPage?(query: string, options?: SearchOptions): Promise<SearchPage>
  expand(externalRef: string, options?: ExpandOptions): Promise<ListExpansion>
  /**
   * How many items `expand(ref)` would give, for a source that can say so in far fewer requests than listing it
   * (YouTube: one or two, against a request for every fifty videos). Used where only the number is wanted, the
   * Search tab's per-result count, which is asked for every result. `undefined` means "no cheap answer": the
   * caller lists the source as it would without this. Absent: always list.
   */
  count?(externalRef: string): Promise<number | undefined>
  /**
   * The lengths of items an `expand(ref, { runtimes: 'skip' })` left without
   * one, keyed by item ref. Answers only for refs this adapter owns; one ref's
   * failure is that ref's `failed`, never the whole call's. Absent: the adapter
   * has nothing to look up afterwards.
   */
  enrich?(refs: string[]): Promise<Map<string, RuntimeLookup>>
  /**
   * The kinds of item ref (`movie`) `enrich` answers for. What a runner asks the
   * database to find pending, so it needs the adapter's own answer and not a
   * guess from the ref's shape. Set with `enrich`; absent means nothing to look up.
   */
  enrichPrefixes?: readonly string[]
}

export interface MediaType {
  key: string
  label: string
  /**
   * Shown in the UI where the category is chosen. Most categories need none —
   * "Movies" explains itself — but a shelf whose purpose is not obvious does.
   */
  description?: string
  /** Display order in the UI; gaps left so categories can be slotted between. */
  sortOrder: number
  /**
   * Fallback duration when nothing better is known, stored with
   * `timeToConsumeIsEstimated = true` and overridable per item (SPEC.md §4).
   *
   * These are the project owner's numbers, not derived from anything — they
   * exist so Quickie can rank a list the moment it is created, without waiting
   * on a lookup that may never be possible for that category.
   */
  defaultDurationMinutes: number
  adapter?: SearchAdapter
  /**
   * Display name of the adapter's upstream source ("TMDB", "Wikipedia"), shown
   * as the category tile's footer. Set alongside `adapter`; a category with
   * no adapter is "by hand" and has none.
   */
  sourceName?: string
  /**
   * Which of an item's `tags` mean Type/Medium, Language and Platform for
   * this category (facets.ts). Absent: the list gets a text filter and no
   * facets. Derivation is read-time only, so a convention needs no migration.
   */
  facets?: FacetConvention
  /**
   * `'library'`: the app's own search offers only curated community-library
   * lists for this category, never the adapter's results. The adapter stays
   * for the list generator (`tools/generateList.ts`) and for lists already
   * built from it. Mega (owner ruling 2026-09-26, F9): TMDB keywords cannot
   * build a whole franchise, so users get curated lists only.
   */
  searchScope?: 'library'
  /**
   * The longest a fetched list's stored source copy may age before it must be
   * refreshed or dropped, for a source whose terms cap stored API data:
   * YouTube 30 days (Developer Policies III.E.4), TMDB 180 (API terms 1.C).
   * Absent where the source sets no cap. Config on the entry, not a list of
   * keys, so a new capped source is one line (docs/DECISIONS.md, task 12.1).
   */
  sourceCopyMaxDays?: number
}

/** What `GET /media-types` (and the standalone app's `mediaTypes()`) returns per category. */
export interface MediaTypeInfo {
  key: string
  label: string
  description?: string
  sortOrder: number
  defaultDurationMinutes: number
  /** Whether search is offered for this category. Manual entry always works. */
  searchAvailable: boolean
  /** Whether a preview-before-import can be fetched — the same gate as search. */
  previewable: boolean
  sourceName?: string
  /** The category's facet convention; absent when it has none. */
  facets?: FacetConvention
  /** Present when search offers only community-library lists; the client names that source itself. */
  searchScope?: 'library'
  /** Days a stored source copy may age before it is refreshed or dropped; absent when the source sets no cap. */
  sourceCopyMaxDays?: number
}

/**
 * The one place a registry entry becomes its wire shape, shared by the
 * server route and the standalone app so the two surfaces cannot drift.
 * The source name reflects the registry, not whether credentials are present:
 * an unkeyed TMDB category is still "TMDB", just not searchable yet.
 */
export function toMediaTypeInfo({
  key,
  label,
  description,
  sortOrder,
  defaultDurationMinutes,
  adapter,
  sourceName,
  facets,
  searchScope,
  sourceCopyMaxDays,
}: MediaType): MediaTypeInfo {
  // The library needs no key, so a library-only category can always search and preview.
  const available = searchScope === 'library' || (adapter?.isAvailable() ?? false)

  return {
    key,
    label,
    ...(description ? { description } : {}),
    sortOrder,
    defaultDurationMinutes,
    searchAvailable: available,
    previewable: available,
    ...(adapter && sourceName && !searchScope ? { sourceName } : {}),
    ...(facets?.length ? { facets } : {}),
    ...(searchScope ? { searchScope } : {}),
    ...(sourceCopyMaxDays ? { sourceCopyMaxDays } : {}),
  }
}

/**
 * The server's own instance: `process.env`-backed credentials, direct
 * `fetch` for every provider. The standalone app builds its own via
 * `createDefaultMediaTypes({ credentials, fetchImpl })` instead (see
 * `web/src/lib/ingestion/localMediaTypes.ts`).
 */
export const DEFAULT_MEDIA_TYPES: readonly MediaType[] = createDefaultMediaTypes()

export interface MediaTypeRegistry {
  list(): MediaType[]
  get(key: string): MediaType | undefined
  has(key: string): boolean
  keys(): string[]
}

/**
 * Built as a dependency rather than module-level mutable state, so tests can
 * add a category without leaking it into other tests — and so "adding a
 * category" in production stays a single edit to DEFAULT_MEDIA_TYPES.
 */
export function createMediaTypeRegistry(
  entries: readonly MediaType[] = DEFAULT_MEDIA_TYPES,
): MediaTypeRegistry {
  const sorted = [...entries].sort((a, b) => a.sortOrder - b.sortOrder)
  const byKey = new Map(sorted.map((entry) => [entry.key, entry]))

  if (byKey.size !== sorted.length) {
    throw new Error('Duplicate media type key in registry')
  }

  return {
    list: () => [...sorted],
    get: (key) => byKey.get(key),
    has: (key) => byKey.has(key),
    keys: () => sorted.map((entry) => entry.key),
  }
}
