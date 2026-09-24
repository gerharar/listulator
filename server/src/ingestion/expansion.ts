import type { ListExpansion, MediaTypeCandidate } from './mediaTypes.js'

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
  expandItems: (externalRef: string) => Promise<MediaTypeCandidate[]>,
): (externalRef: string) => Promise<ListExpansion> {
  return async (externalRef) => ({ items: await expandItems(externalRef) })
}
