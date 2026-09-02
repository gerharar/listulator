import { createMusicBrainzAdapter } from './adapters/musicbrainz.js'
import { createTmdbAdapter } from './adapters/tmdb.js'

/**
 * Credentials are read per call rather than captured here: this module is
 * evaluated during import, which is before the entry point loads `.env`.
 * Adapters report themselves unavailable when their credentials are missing,
 * so an unkeyed install simply has no search for that category.
 */
const tmdb = createTmdbAdapter(() => ({
  apiKey: process.env['TMDB_API_KEY'],
  readAccessToken: process.env['TMDB_READ_ACCESS_TOKEN'],
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
   * Every value here is a defensible guess, not a measurement.
   */
  defaultDurationMinutes: number
  adapter?: SearchAdapter
}

export const DEFAULT_MEDIA_TYPES: readonly MediaType[] = [
  { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 110, adapter: tmdb },
  { key: 'tv', label: 'TV Shows', sortOrder: 20, defaultDurationMinutes: 45 },
  // Covers both ~22 min series episodes and ~100 min features; 30 splits the
  // difference badly on purpose — it is flagged estimated and easy to correct.
  { key: 'animation', label: 'Animation', sortOrder: 30, defaultDurationMinutes: 30 },
  { key: 'wrestling', label: 'Wrestling', sortOrder: 40, defaultDurationMinutes: 150 },
  { key: 'mma', label: 'MMA', sortOrder: 50, defaultDurationMinutes: 180 },
  // Time-to-beat for a mainline game, not a completionist run.
  { key: 'game', label: 'Games', sortOrder: 60, defaultDurationMinutes: 900 },
  // ~15 min for a standard 30-page issue (SPEC.md §5).
  { key: 'comic', label: 'Comics', sortOrder: 70, defaultDurationMinutes: 15 },
  // ~80k words at ~250 wpm.
  { key: 'book', label: 'Books', sortOrder: 80, defaultDurationMinutes: 360 },
  {
    key: 'music',
    label: 'Music',
    sortOrder: 90,
    defaultDurationMinutes: 45,
    adapter: createMusicBrainzAdapter(),
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
