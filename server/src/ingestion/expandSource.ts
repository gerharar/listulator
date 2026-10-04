import { MAX_LIST_ITEMS } from '../catalog/limits.js'
import {
  canonicalPathFromExternalRef,
  expandCanonicalList,
  isSafeCanonicalPath,
} from './customLists.js'
import { expansionCacheKey, type ExpansionCache } from './expansionCache.js'
import type { ExpandOptions, ListExpansion, MediaType, SearchAdapter } from './mediaTypes.js'
import { refForAdapter, type SourceOptions } from './sourceRef.js'

/** The category has no adapter that can run right now (usually a missing API key). */
export class SourceUnavailableError extends Error {
  constructor(readonly category: string) {
    super(`Search is not available for ${category}.`)
    this.name = 'SourceUnavailableError'
  }
}

/** A source with more items than a list can hold (`MAX_LIST_ITEMS`): refused, never cut short. */
export class ListTooLargeError extends Error {
  constructor(
    readonly count: number,
    readonly max: number = MAX_LIST_ITEMS,
    /** The list or source that is too large, where the caller knows it (Reset, a check): the sentence names it. */
    readonly title?: string,
  ) {
    super(`A list holds at most ${max} items; this source has ${count}.`)
    this.name = 'ListTooLargeError'
  }
}

/** Throws `ListTooLargeError` when `count` is above the ceiling. Checked for the count, the Preview and Add list. */
export function checkListSize(count: number): void {
  if (count > MAX_LIST_ITEMS) throw new ListTooLargeError(count)
}

/** A canonical ref whose path is not one this app would ever fetch. */
export class UnsafeSourceError extends Error {
  constructor() {
    super('Not a valid canonical list path.')
    this.name = 'UnsafeSourceError'
  }
}

/**
 * How a source is listed (task 15.5, 15.8): one whose lengths can be looked up afterwards (its adapter has
 * `enrich` and says which refs) is listed **without** them, so the count, the Preview and Add list cost a
 * listing and not a request for every item; the build fills the lengths in afterwards. Any other source has
 * nothing to skip and is expanded in full, as it always was. The count, the Preview and the build all use
 * this, so they ask for the same thing and share one cached listing.
 */
export function listingOptions(adapter: SearchAdapter): ExpandOptions | undefined {
  return adapter.enrich && adapter.enrichPrefixes?.length ? { runtimes: 'skip' } : undefined
}

/**
 * The item count of one search result by the adapter's own cheap count, where it has one (`SearchAdapter.count`),
 * without listing the source; `undefined` when there is none, so the caller expands as it always did. Only the
 * Search tab's per-result count wants this, and it is asked for every result, so a source that costs a request for
 * every fifty items to list (a YouTube channel) costs one or two here. Refused above the ceiling exactly as a
 * listing is. A curated list, a category with no usable adapter and an adapter without `count` all answer
 * `undefined`: the listing path owns their errors.
 */
export async function countSource(
  mediaType: Pick<MediaType, 'key' | 'label' | 'adapter'>,
  externalRef: string,
  options: SourceOptions,
): Promise<number | undefined> {
  if (canonicalPathFromExternalRef(externalRef)) return undefined

  const adapter = mediaType.adapter
  if (!adapter?.count || !adapter.isAvailable()) return undefined

  const count = await adapter.count(refForAdapter(externalRef, options))
  if (count !== undefined) checkListSize(count)

  return count
}

/**
 * Expands one search result without creating anything: its items and, where
 * the source has an honest signal, its production status. What the Search
 * tab's per-result count comes from (task 10.12, Q11) — and what 10.15's
 * Preview will widen to show the items themselves.
 *
 * Shared by the server route and the standalone app so the two cannot
 * drift. With a `cache`, an adapter expansion is shared with whatever else
 * asks for the same source shortly after (Preview, Add list). A canonical (community-library) result is fetched and parsed
 * directly; anything else goes through the category's adapter with the same
 * ref an import would use, so the count shown is the count Add list makes.
 */
export async function expandSource(
  mediaType: Pick<MediaType, 'key' | 'label' | 'adapter'>,
  externalRef: string,
  options: SourceOptions,
  validCategories: ReadonlySet<string>,
  cache?: ExpansionCache,
): Promise<ListExpansion> {
  const canonicalPath = canonicalPathFromExternalRef(externalRef)

  if (canonicalPath) {
    if (!isSafeCanonicalPath(canonicalPath)) throw new UnsafeSourceError()
    return expandCanonicalList(canonicalPath, validCategories)
  }

  if (!mediaType.adapter?.isAvailable()) throw new SourceUnavailableError(mediaType.label)

  const adapter = mediaType.adapter
  const adapterRef = refForAdapter(externalRef, options)

  // Only adapter expansions are remembered: they are the ones that cost many
  // upstream requests. A curated list is one small file.
  const expandOptions = listingOptions(adapter)
  const load = () => (expandOptions ? adapter.expand(adapterRef, expandOptions) : adapter.expand(adapterRef))

  const expansion = await (cache ? cache.get(expansionCacheKey(mediaType.key, adapterRef, expandOptions), load) : load())
  checkListSize(expansion.items.length)

  return expansion
}
