import {
  canonicalPathFromExternalRef,
  expandCanonicalList,
  isSafeCanonicalPath,
} from './customLists.js'
import type { ListExpansion, MediaType } from './mediaTypes.js'
import { refForAdapter, type SourceOptions } from './sourceRef.js'

/** The category has no adapter that can run right now (usually a missing API key). */
export class SourceUnavailableError extends Error {
  constructor(readonly category: string) {
    super(`Search is not available for ${category}.`)
    this.name = 'SourceUnavailableError'
  }
}

/** A canonical ref whose path is not one this app would ever fetch. */
export class UnsafeSourceError extends Error {
  constructor() {
    super('Not a valid canonical list path.')
    this.name = 'UnsafeSourceError'
  }
}

/**
 * Expands one search result without creating anything: its items and, where
 * the source has an honest signal, its production status. What the Search
 * tab's per-result count comes from (task 10.12, Q11) — and what 10.15's
 * Preview will widen to show the items themselves.
 *
 * Shared by the server route and the standalone app so the two cannot
 * drift. A canonical (community-library) result is fetched and parsed
 * directly; anything else goes through the category's adapter with the same
 * ref an import would use, so the count shown is the count Add list makes.
 */
export async function expandSource(
  mediaType: MediaType,
  externalRef: string,
  options: SourceOptions,
  validCategories: ReadonlySet<string>,
): Promise<ListExpansion> {
  const canonicalPath = canonicalPathFromExternalRef(externalRef)

  if (canonicalPath) {
    if (!isSafeCanonicalPath(canonicalPath)) throw new UnsafeSourceError()
    return expandCanonicalList(canonicalPath, validCategories)
  }

  if (!mediaType.adapter?.isAvailable()) throw new SourceUnavailableError(mediaType.label)

  return mediaType.adapter.expand(refForAdapter(externalRef, options))
}
