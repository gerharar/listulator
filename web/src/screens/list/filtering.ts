import { matchesFacets, type FacetConvention, type FacetSelection } from '../../../../server/src/catalog/facets.js'
import type { ListItem } from '../../lib/api.js'
import { itemNotes } from './itemNotes.js'

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

/** A filter that says which rows match (text, a facet): Hide Completed is not one, it only takes away what the progress already counts (H-010). */
export function isMatchFiltering(filter: ListFilter): boolean {
  return filter.text.trim() !== '' || Object.values(filter.facets).some((chosen) => chosen && chosen.size > 0)
}

/** How many of a group's items a matching filter leaves, or `undefined` when it leaves them all (nothing to say, H-010). */
export function matchedCount(items: readonly ListItem[], matching: ReadonlySet<string>): number | undefined {
  const count = items.filter((entry) => matching.has(entry.id)).length

  return count < items.length ? count : undefined
}

const contains = (haystack: string | null, needle: string) => haystack !== null && haystack.toLowerCase().includes(needle)

/**
 * Which note is why a row is shown (H-003): the filter text is not in the title but is in a note, so its ⓘ lights.
 * `mine` when the user's own note has the text (alone or with the curator's), `curator` when only the curator's does.
 * A title match is never marked, as before.
 */
export function noteOnlyMatch(item: ListItem, text: string): 'curator' | 'mine' | null {
  const needle = text.trim().toLowerCase()
  if (needle === '' || item.title.toLowerCase().includes(needle)) return null
  const { curator, mine } = itemNotes(item)
  if (contains(mine, needle)) return 'mine'
  if (contains(curator, needle)) return 'curator'

  return null
}

/**
 * The ids of the items that pass: the title, the group's name, the curator's note or the user's own note contains the text, every facet with a selection agrees, and under Hide
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
  // A group name is lower-cased once, not once per row: a long list has few groups and many rows.
  const groupHasNeedle = new Map<string, boolean>()
  const inGroupName = (group: string | null | undefined) => {
    if (!group) return false
    let found = groupHasNeedle.get(group)
    if (found === undefined) {
      found = group.toLowerCase().includes(needle)
      groupHasNeedle.set(group, found)
    }

    return found
  }

  return new Set(
    items
      .filter(
        (entry) =>
          (needle === '' ||
            entry.title.toLowerCase().includes(needle) ||
            inGroupName(entry.group) ||
            noteOnlyMatch(entry, needle) !== null) &&
          matchesFacets(entry, convention, filter.facets) &&
          (!filter.hideDone || entry.consumedAt === null || keep.has(entry.id)),
      )
      .map((entry) => entry.id),
  )
}
