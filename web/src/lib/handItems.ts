export interface HandItem {
  title: string
  group?: string
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

    items.push(current === undefined ? { title: line } : { title: line, group: current })
  }

  return { items, groups }
}
