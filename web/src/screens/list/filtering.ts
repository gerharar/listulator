import { matchesFacets, type FacetConvention, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'

/** The list screen's view state: what the reader typed and which facet buttons are on. Never saved. */
export interface ListFilter {
  text: string
  facets: FacetSelection
}

export const NO_FILTER: ListFilter = { text: '', facets: {} }

export function isFiltering(filter: ListFilter): boolean {
  return filter.text.trim() !== '' || Object.values(filter.facets).some((chosen) => chosen && chosen.size > 0)
}

/** The ids of the items that pass: the title contains the text, and every facet with a selection agrees. */
export function shownItemIds(
  items: readonly ListItem[],
  convention: FacetConvention | undefined,
  filter: ListFilter,
): Set<string> {
  const needle = filter.text.trim().toLowerCase()

  return new Set(
    items
      .filter(
        (entry) =>
          (needle === '' || entry.title.toLowerCase().includes(needle)) &&
          matchesFacets(entry, convention, filter.facets),
      )
      .map((entry) => entry.id),
  )
}
