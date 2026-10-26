import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'

/** How many cards the shelf has at most. */
export const SHELF_SIZE = 3

/**
 * The lists on the List Vault shelf (H-018; owner, 2026-10-22, three since the usability test of 2026-10-26): up to three, each from a different
 * category, and one random list from each of those. The categories are chosen at random too; a library with fewer categories than three gives a
 * card for each of them. The random source is a parameter so a test can fix it. Nothing is changed in `entries`.
 */
export function shelfPicks(entries: readonly LibraryEntry[], random: () => number): LibraryEntry[] {
  const byCategory = new Map<string, LibraryEntry[]>()
  for (const entry of entries) byCategory.set(entry.category, [...(byCategory.get(entry.category) ?? []), entry])

  // Fisher–Yates over the categories, then the first three.
  const categories = [...byCategory.keys()]
  for (let at = categories.length - 1; at > 0; at -= 1) {
    const other = Math.floor(random() * (at + 1))
    ;[categories[at], categories[other]] = [categories[other]!, categories[at]!]
  }

  return categories.slice(0, SHELF_SIZE).map((category) => {
    const lists = byCategory.get(category)!

    return lists[Math.floor(random() * lists.length)]!
  })
}
