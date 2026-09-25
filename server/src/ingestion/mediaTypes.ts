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
import { createTmdbFranchiseAdapter } from './adapters/tmdbFranchise.js'
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
  })

  const documentarySeries = createTmdbTvAdapter(tmdbCredentials, {
    genreFilter: DOCUMENTARY_GENRE,
  })
  const documentaryFilms = createTmdbAdapter(tmdbCredentials, {
    documentaries: 'only',
    // Documentarians direct rather than appear; cast credits alone found 12 of
    // Ken Burns' 59 documentaries.
    includeDirecting: true,
  })

  const tmdbTv = createTmdbTvAdapter(tmdbCredentials)
  const franchises = createTmdbFranchiseAdapter(tmdbCredentials)

  /** Films by a person or collection, plus films by a studio. */
  const movieSources = createCompositeAdapter([
    { prefixes: ['person', 'collection'], adapter: films },
    { prefixes: ['company'], adapter: studios },
  ])

  /** Animated series, plus the studios that make animated films. */
  const animationSources = createCompositeAdapter([
    { prefixes: ['show'], tag: 'tv', adapter: animatedShows },
    { prefixes: ['company'], tag: 'movie', adapter: animationStudios },
  ])

  /** Documentary series, plus a film-maker's documentaries. */
  const documentarySources = createCompositeAdapter([
    { prefixes: ['show'], adapter: documentarySeries },
    { prefixes: ['person', 'collection'], adapter: documentaryFilms },
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
    },
    {
      key: 'tv',
      label: 'TV Shows',
      sortOrder: 20,
      defaultDurationMinutes: 50,
      adapter: tmdbTv,
      sourceName: 'TMDB',
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
      facets: [{ key: 'type', label: 'Type', values: ['Album', 'EP', 'Single', 'Live', 'Compilation'] }],
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
    },
    /**
     * The shelf for franchises that genuinely span media. Its existence is a
     * navigation answer more than a data one: a Marvel list split across
     * Movies, TV and Animation leaves nowhere obvious to look.
     */
    {
      key: 'mega',
      label: 'Mega',
      description:
        'Franchises that span several media at once — films, series and animation together, in release order. Marvel and Star Trek belong here; a single show or film series does not.',
      sortOrder: 100,
      // Mixed by nature; real runtimes come from the API.
      defaultDurationMinutes: 120,
      adapter: franchises,
      sourceName: 'TMDB',
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

export interface SearchAdapter {
  /** False when, say, an API key is missing — the UI hides search for it. */
  isAvailable(): boolean
  search(query: string, options?: SearchOptions): Promise<ListSource[]>
  expand(externalRef: string): Promise<ListExpansion>
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
}: MediaType): MediaTypeInfo {
  const available = adapter?.isAvailable() ?? false

  return {
    key,
    label,
    ...(description ? { description } : {}),
    sortOrder,
    defaultDurationMinutes,
    searchAvailable: available,
    previewable: available,
    ...(adapter && sourceName ? { sourceName } : {}),
    ...(facets?.length ? { facets } : {}),
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
