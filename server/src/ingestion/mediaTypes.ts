import { createComicVineAdapter } from './adapters/comicVine.js'
import { createIgdbAdapter } from './adapters/igdb.js'
import { createMusicBrainzAdapter } from './adapters/musicbrainz.js'
import { createYouTubeAdapter } from './adapters/youtube.js'
import {
  createWikipediaEventsAdapter,
  MMA_PROMOTIONS,
  WRESTLING_PROMOTIONS,
} from './adapters/wikipediaEvents.js'
import { createOpenLibraryAdapter } from './adapters/openLibrary.js'
import { createCompositeAdapter } from './adapters/composite.js'
import { createTmdbAdapter } from './adapters/tmdb.js'
import { createTmdbCompanyAdapter } from './adapters/tmdbCompany.js'
import { ANIMATION_GENRE, DOCUMENTARY_GENRE, createTmdbTvAdapter } from './adapters/tmdbTv.js'

/**
 * Credentials are read per call rather than captured here: this module is
 * evaluated during import, which is before the entry point loads `.env`.
 * Adapters report themselves unavailable when their credentials are missing,
 * so an unkeyed install simply has no search for that category.
 */

const tmdbCredentials = () => ({
  apiKey: process.env['TMDB_API_KEY'],
  readAccessToken: process.env['TMDB_READ_ACCESS_TOKEN'],
})

/**
 * Several categories draw on more than one shape of TMDB search, because a
 * medium is not a search shape. Animation holds both Naruto (a series) and
 * Studio Ghibli (a studio of films); documentaries hold both series and a
 * director's body of work. Each category still picks its own sources — there
 * is no cross-cutting "TMDB" category (docs/DECISIONS.md).
 */
const films = createTmdbAdapter(tmdbCredentials)
const studios = createTmdbCompanyAdapter(tmdbCredentials)

const animatedShows = createTmdbTvAdapter(tmdbCredentials, { genreFilter: ANIMATION_GENRE })
const animationStudios = createTmdbCompanyAdapter(tmdbCredentials, {
  genreFilter: ANIMATION_GENRE,
})

const documentarySeries = createTmdbTvAdapter(tmdbCredentials, { genreFilter: DOCUMENTARY_GENRE })
const documentaryFilms = createTmdbAdapter(tmdbCredentials, {
  documentaries: 'only',
  // Documentarians direct rather than appear; cast credits alone found 12 of
  // Ken Burns' 59 documentaries.
  includeDirecting: true,
})

const tmdbTv = createTmdbTvAdapter(tmdbCredentials)

/** Films by a person or collection, plus films by a studio. */
const movieSources = createCompositeAdapter([
  { prefixes: ['person', 'collection'], adapter: films },
  { prefixes: ['company'], adapter: studios },
])

/** Animated series, plus the studios that make animated films. */
const animationSources = createCompositeAdapter([
  { prefixes: ['show'], adapter: animatedShows },
  { prefixes: ['company'], adapter: animationStudios },
])

/** Documentary series, plus a film-maker's documentaries. */
const documentarySources = createCompositeAdapter([
  { prefixes: ['show'], adapter: documentarySeries },
  { prefixes: ['person', 'collection'], adapter: documentaryFilms },
])

const igdb = createIgdbAdapter(() => ({
  clientId: process.env['IGDB_CLIENT_ID'],
  clientSecret: process.env['IGDB_CLIENT_SECRET'],
}))

const comicVine = createComicVineAdapter(() => ({
  apiKey: process.env['COMIC_VINE_API_KEY'],
}))

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
export interface SearchAdapter {
  /** False when, say, an API key is missing — the UI hides search for it. */
  isAvailable(): boolean
  search(query: string): Promise<ListSource[]>
  expand(externalRef: string): Promise<MediaTypeCandidate[]>
}

export interface MediaType {
  key: string
  label: string
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
}

export const DEFAULT_MEDIA_TYPES: readonly MediaType[] = [
  {
    key: 'movie',
    label: 'Movies',
    sortOrder: 10,
    defaultDurationMinutes: 120,
    adapter: movieSources,
  },
  { key: 'tv', label: 'TV Shows', sortOrder: 20, defaultDurationMinutes: 50, adapter: tmdbTv },
  // Episode-length. The category also holds animated features, which this
  // badly under-estimates — flagged estimated and easy to correct per item.
  {
    key: 'animation',
    label: 'Animation',
    sortOrder: 30,
    defaultDurationMinutes: 25,
    adapter: animationSources,
  },
  // Feature-length is the common case for a documentary; series episodes run
  // shorter and are corrected per item.
  {
    key: 'documentary',
    label: 'Documentaries',
    sortOrder: 35,
    defaultDurationMinutes: 90,
    adapter: documentarySources,
  },
  {
    key: 'wrestling',
    label: 'Wrestling',
    sortOrder: 40,
    defaultDurationMinutes: 180,
    adapter: createWikipediaEventsAdapter(WRESTLING_PROMOTIONS),
  },
  {
    key: 'mma',
    label: 'MMA',
    sortOrder: 50,
    defaultDurationMinutes: 180,
    adapter: createWikipediaEventsAdapter(MMA_PROMOTIONS),
  },
  // Time-to-beat for a mainline game, not a completionist run.
  { key: 'game', label: 'Games', sortOrder: 60, defaultDurationMinutes: 600, adapter: igdb },
  // ~15 min for a standard 30-page issue (SPEC.md §5). Comic Vine's rate
  // limit rules out fetching a real page count per issue.
  {
    key: 'comic',
    label: 'Comics',
    sortOrder: 70,
    defaultDurationMinutes: 15,
    adapter: comicVine,
  },
  {
    key: 'book',
    label: 'Books',
    sortOrder: 80,
    defaultDurationMinutes: 240,
    adapter: createOpenLibraryAdapter(),
  },
  {
    key: 'music',
    label: 'Music',
    sortOrder: 90,
    defaultDurationMinutes: 45,
    adapter: createMusicBrainzAdapter(),
  },
  // Lengths vary from three minutes to three hours, so this default is more
  // placeholder than estimate — real durations come from the API.
  {
    key: 'youtube',
    label: 'YouTube',
    sortOrder: 95,
    defaultDurationMinutes: 20,
    adapter: createYouTubeAdapter(() => ({ apiKey: process.env['YOUTUBE_API_KEY'] })),
  },
]

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
