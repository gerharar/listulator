import { splitTrailingYear } from '../../../server/src/catalog/years.js'

export interface HandItem {
  title: string
  group?: string
  /** A year in brackets at the end of the line (H-004), or the earliest it can be when `yearUnk` is set. */
  year?: number
  /** How many of `year`'s last digits are unknown (H-005): present only for `(199?)` and `(19??)`. */
  yearUnk?: number
}

export interface ParsedHandItems {
  items: HandItem[]
  /** Distinct group names in the order they were first opened, empty ones included. */
  groups: string[]
}

/** A markdown heading of any level, or a line ending in a colon, opens a group. */
function groupName(line: string): string | undefined {
  const heading = /^#+\s*(.*)$/.exec(line)
  const name = (heading ? heading[1]! : line.endsWith(':') ? line.slice(0, -1) : undefined)?.trim()

  // A marker with no name ("#", ":") is an empty string: it opens nothing, and
  // is not an item either.
  return name
}

/**
 * The Add-by-hand textarea: one item per line, blank lines ignored so pasted
 * text needs no tidying. A group line applies to every item after it, until
 * the next one.
 */
export function parseHandItems(raw: string): ParsedHandItems {
  const items: HandItem[] = []
  const groups: string[] = []
  let current: string | undefined

  for (const line of raw.split('\n').map((entry) => entry.trim())) {
    if (line.length === 0) continue

    const name = groupName(line)
    if (name !== undefined) {
      if (name.length === 0) continue
      current = name
      if (!groups.includes(name)) groups.push(name)
      continue
    }

    // A year in brackets at the very end is the item's year (`Fast Five (2011)`, `(199?)`); a bracket anywhere else, or a
    // year the app does not hold, stays in the title (`Spider-Man (1990) #57`, `Foo (0000)`).
    const split = splitTrailingYear(line)
    const year = split ? { year: split.year.year!, ...(split.year.yearUnk ? { yearUnk: split.year.yearUnk } : {}) } : {}

    items.push({ title: split ? split.title : line, ...(current === undefined ? {} : { group: current }), ...year })
  }

  return { items, groups }
}
