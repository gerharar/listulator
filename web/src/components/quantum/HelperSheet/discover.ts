import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'

/** The whole spin, in milliseconds (prototype): the dials slow to a stop against the clock, not a step count. */
export const SPIN_MS = 1700

/** How long the dials hold between two random faces: 55ms at the start, easing to about 315ms at the end. */
export function spinDelay(progress: number): number {
  return 55 + progress * progress * 260
}

/**
 * The library lists in play: all of them, or those on any picked shelf. Shelves
 * are a facet, not a radio: none picked means the whole library.
 */
/**
 * The picked shelves that still have something in them (design, 2026-11-20): one that has emptied (its last candidate is tracked now) is unpicked at once, so the pool
 * never stalls on it, and with none left picked it is Any, as with nothing picked.
 */
export function pickedShelves(entries: readonly LibraryEntry[], shelves: ReadonlySet<string>): Set<string> {
  return new Set([...shelves].filter((key) => entries.some((entry) => entry.category === key)))
}

export function candidatePool(entries: readonly LibraryEntry[], shelves: ReadonlySet<string>): LibraryEntry[] {
  return entries.filter((entry) => shelves.size === 0 || shelves.has(entry.category))
}

const DIALS = 6
const DASH = '—'

/** The item count on six dials; dashes when the index has none, and no more than the dials can hold. */
export function digitsFor(count: number | undefined): string {
  if (count === undefined) return DASH.repeat(DIALS)

  return String(Math.min(count, 10 ** DIALS - 1)).padStart(DIALS, '0')
}

/** A random face for the dials, for the spin. */
export function randomDigits(random: () => number): string {
  return String(Math.floor(random() * 10 ** DIALS)).padStart(DIALS, '0')
}
