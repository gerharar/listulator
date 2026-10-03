import { searchLibrary } from './customLists.js'
import type { ListSource, MediaType, SearchOptions } from './mediaTypes.js'

/** Search offered nothing at all: `search.unavailable` (no source), or `…Offline` (the library could not be reached either). */
export class SearchUnavailableError extends Error {
  constructor(readonly code: 'search.unavailable' | 'search.unavailableOffline') {
    super(code)
  }
}

export interface SearchResult {
  sources: ListSource[]
  /** Only when true: curated lists may be missing from these results. */
  libraryUnreachable?: true
}

/**
 * One category's search, shared by the server route and the standalone app so
 * the two cannot drift. Community-library matches come first (task 7.4); then
 * the category's own adapter, unless the category searches the library only
 * (`searchScope: 'library'` — Mega, which has no adapter: its lists are
 * curated, never fetched from a connector, F9).
 */
export async function searchSources(
  mediaType: MediaType,
  query: string,
  options: SearchOptions,
  library: typeof searchLibrary = searchLibrary,
): Promise<SearchResult> {
  const { matches, reachable } = await library(mediaType.key, query)

  if (mediaType.searchScope === 'library') {
    if (!reachable && matches.length === 0) throw new SearchUnavailableError('search.unavailableOffline')
    return { sources: matches, ...(reachable ? {} : { libraryUnreachable: true as const }) }
  }

  if (!mediaType.adapter?.isAvailable()) {
    // Not an error when the library matched: plenty of categories will never
    // have search, and the manual path always works. If the library could not
    // be reached as well, say so — a missing key is then only half the story.
    if (matches.length === 0) {
      throw new SearchUnavailableError(reachable ? 'search.unavailable' : 'search.unavailableOffline')
    }
    return { sources: matches }
  }

  return {
    sources: [...matches, ...(await mediaType.adapter.search(query, options))],
    ...(reachable ? {} : { libraryUnreachable: true as const }),
  }
}
