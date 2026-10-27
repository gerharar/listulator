import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { compareShown, copy } from '../../../locale/index.js'

export type SortKey = 'name' | 'status' | 'items' | 'time'
export interface BrowserSort {
  key: SortKey
  /** 1 ascending, -1 descending. */
  dir: 1 | -1
}

/** The browser opens on Name A to Z. */
export const DEFAULT_SORT: BrowserSort = { key: 'name', dir: 1 }

/** A click on a header: the same column reverses; another starts at its natural end (names and statuses A to Z, counts and times largest first). */
export function nextSort(current: BrowserSort, key: SortKey): BrowserSort {
  if (current.key === key) return { key, dir: current.dir === 1 ? -1 : 1 }

  return { key, dir: key === 'name' || key === 'status' ? 1 : -1 }
}

/** Complete, then unknown (no status said), then ongoing: the order My Lists keeps. */
const STATUS_RANK = { complete: 0, unknown: 1, ongoing: 2 } as const

function rankOf(entry: LibraryBrowserEntry, key: Exclude<SortKey, 'name'>): number {
  // A number an older index did not give counts as the least, so the table does not scramble on it.
  if (key === 'items') return entry.itemCount ?? -1
  if (key === 'time') return entry.totalMinutes ?? -1

  return STATUS_RANK[entry.status ?? 'unknown']
}

/** The rows in the order of `sort`; a tie goes by name A to Z whichever way the column runs. A new array. */
export function sortRows(rows: readonly LibraryBrowserEntry[], sort: BrowserSort): LibraryBrowserEntry[] {
  return [...rows].sort((a, b) => {
    const byColumn = sort.key === 'name' ? compareShown(a.title, b.title) : rankOf(a, sort.key) - rankOf(b, sort.key)

    return byColumn * sort.dir || compareShown(a.title, b.title)
  })
}

/** A list's length for the Time column: under an hour its minutes, from an hour whole hours rounded half up, in the locale's own duration strings. */
export function browserTime(minutes: number): string {
  if (minutes < 60) return copy.duration.minutes(minutes)

  return copy.duration.hours(Math.floor((minutes + 30) / 60))
}
