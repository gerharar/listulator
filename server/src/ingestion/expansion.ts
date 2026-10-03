import type { ExpandOptions, ListExpansion, MediaTypeCandidate, SearchAdapter } from './mediaTypes.js'

/**
 * Adapts an items-only expander to `SearchAdapter.expand()`'s shape. Using it
 * is how an adapter says, greppably, "I have no honest upstream signal for
 * the list's production status" (task 10.11b, BL-013) — the result carries no
 * `status` key at all, never a guess.
 *
 * A module of its own rather than a helper in `mediaTypes.ts`: that file
 * imports every adapter, so an adapter importing a *value* from it would be a
 * cycle.
 */
export function itemsOnly(
  expandItems: (externalRef: string, options?: ExpandOptions) => Promise<MediaTypeCandidate[]>,
): (externalRef: string, options?: ExpandOptions) => Promise<ListExpansion> {
  return async (externalRef, options) => ({ items: await expandItems(externalRef, options) })
}

/**
 * The full expansion by the two-step route: list without lengths, then look
 * the missing ones up. For a caller that wants every length now (the list
 * generator) and not a list built first and filled later; the result equals
 * `adapter.expand(ref)` whenever every lookup succeeds. A length that is `none`
 * or `failed` stays absent, so the caller marks the item estimated, as the
 * inline expansion does for a lookup that failed. An adapter with no `enrich`
 * has nothing to split, and is simply expanded in full.
 */
export async function expandWithRuntimes(adapter: SearchAdapter, ref: string): Promise<ListExpansion> {
  if (!adapter.enrich) return await adapter.expand(ref)

  const listing = await adapter.expand(ref, { runtimes: 'skip' })
  const pending = [
    ...new Set(
      listing.items
        .filter((item) => item.externalRef && item.timeToConsumeMinutes === undefined)
        .map((item) => item.externalRef!),
    ),
  ]
  const lookups = await adapter.enrich(pending)

  return {
    ...listing,
    items: listing.items.map((item) => {
      const lookup = item.externalRef ? lookups.get(item.externalRef) : undefined

      return lookup?.status === 'found' && item.timeToConsumeMinutes === undefined
        ? { ...item, timeToConsumeMinutes: lookup.minutes }
        : item
    }),
  }
}
