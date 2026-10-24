import type { MediaType } from '../../../lib/api.js'
import type { KeySource } from '../../../lib/config/keyTest.js'

/** The key a category's source takes, as the registry says (`MediaType.keySource`); null for a source that takes none, or none at all. */
export function keySourceOf(mediaType: MediaType): KeySource | null {
  return mediaType.keySource ?? null
}

/**
 * Whether a free key would unlock the category's own source (H-018). Only in the desktop app, where the person using it adds their own keys; in
 * the web build they live in the server's environment. The source must be one that takes a key (so a keyless source that is down for another
 * reason never asks for one), and Mega's search, the community library alone, takes none. `searchAvailable` is the registry's own answer to
 * "can this source be searched now": it turns true when a key is saved.
 */
export function keyNeeded(mediaType: MediaType, desktop: boolean): boolean {
  return desktop && keySourceOf(mediaType) !== null && mediaType.searchScope !== 'library' && !mediaType.searchAvailable
}

/** TMDB's key is the one the first-run callout is about: it unlocks Movies, TV Series, Animation and Documentaries together. */
export function tmdbKeyNeeded(mediaTypes: readonly MediaType[], desktop: boolean): boolean {
  return mediaTypes.some((mediaType) => keySourceOf(mediaType) === 'tmdb' && keyNeeded(mediaType, desktop))
}
