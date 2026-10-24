import type { MediaType } from '../../../lib/api.js'
import type { KeySource } from '../../../lib/config/keyTest.js'

/** The registry's source names that take a key, and the key source Settings stores each under. Wikipedia, MusicBrainz, Open Library and the library take none. */
const KEY_SOURCES: Readonly<Record<string, KeySource>> = { TMDB: 'tmdb', IGDB: 'igdb', 'Comic Vine': 'comicVine', YouTube: 'youtube' }

export function keySourceOf(mediaType: MediaType): KeySource | null {
  return (mediaType.sourceName !== undefined ? KEY_SOURCES[mediaType.sourceName] : undefined) ?? null
}

/**
 * Whether a free key would unlock the category's own source (H-018). Only in the desktop app, where the person using it adds their own keys; in
 * the web build they live in the server's environment. A category with no source ("by hand") has nothing to unlock, and Mega's search is the
 * community library alone, which takes no key. `searchAvailable` is the registry's own answer to "can this source be searched now": it turns
 * true when a key is saved, and is already true for a source that needs none.
 */
export function keyNeeded(mediaType: MediaType, desktop: boolean): boolean {
  return desktop && Boolean(mediaType.sourceName) && mediaType.searchScope !== 'library' && !mediaType.searchAvailable
}

/** TMDB's key is the one the first-run callout is about: it unlocks Movies, TV Series, Animation and Documentaries together. */
export function tmdbKeyNeeded(mediaTypes: readonly MediaType[], desktop: boolean): boolean {
  return mediaTypes.some((mediaType) => mediaType.sourceName === 'TMDB' && keyNeeded(mediaType, desktop))
}
