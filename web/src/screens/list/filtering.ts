import { matchesFacets, type FacetConvention, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'

/** The list screen's view state: what the reader typed, which facet buttons are on, and Hide Completed. */
export interface ListFilter {
  text: string
  facets: FacetSelection
  /** Hide Completed (task 18.1): done items drop out, like any other filter. */
  hideDone?: boolean
}

export const NO_FILTER: ListFilter = { text: '', facets: {} }

export function isFiltering(filter: ListFilter): boolean {
  return (
    filter.text.trim() !== '' ||
    Object.values(filter.facets).some((chosen) => chosen && chosen.size > 0) ||
    filter.hideDone === true
  )
}

/**
 * The ids of the items that pass: the title contains the text, every facet with a selection agrees, and under Hide
 * Completed the item is not done. `keep` are items ticked done during this visit: they stay where they are, so a tick
 * (or a misclick) never makes a row vanish under the pointer (owner, 2026-10-05).
 */
export function shownItemIds(
  items: readonly ListItem[],
  convention: FacetConvention | undefined,
  filter: ListFilter,
  keep: ReadonlySet<string> = new Set(),
): Set<string> {
  const needle = filter.text.trim().toLowerCase()

  return new Set(
    items
      .filter(
        (entry) =>
          (needle === '' || entry.title.toLowerCase().includes(needle)) &&
          matchesFacets(entry, convention, filter.facets) &&
          (!filter.hideDone || entry.consumedAt === null || keep.has(entry.id)),
      )
      .map((entry) => entry.id),
  )
}
