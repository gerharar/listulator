/**
 * A small wikitext table reader, enough for "List of … events" pages.
 *
 * These pages are the only structured source for wrestling and MMA — neither
 * has a usable API — and their tables are consistent enough to read reliably
 * while varying too much to hardcode: the UFC page is one table of
 * `Event | Date | Venue`, the WWE page is twenty-two tables of
 * `Date | Event | …` grouped by year. Columns are therefore found by header
 * name rather than position.
 */

export interface WikiSection {
  heading: string
  body: string
}

/** Splits a page on its `== Heading ==` lines, keeping the lead as "". */
export function splitSections(wikitext: string): WikiSection[] {
  const sections: WikiSection[] = []
  const pattern = /^==+\s*(.+?)\s*==+\s*$/gm

  let lastHeading = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(wikitext)) !== null) {
    sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex, match.index) })
    lastHeading = match[1]!
    lastIndex = pattern.lastIndex
  }

  sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex) })

  return sections
}

/** Pulls out each `{| … |}` block, tolerating tables nested inside cells. */
export function extractTables(wikitext: string): string[] {
  const tables: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < wikitext.length - 1; index += 1) {
    if (wikitext[index] === '{' && wikitext[index + 1] === '|') {
      if (depth === 0) start = index
      depth += 1
      index += 1
    } else if (wikitext[index] === '|' && wikitext[index + 1] === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) tables.push(wikitext.slice(start, index + 2))
      index += 1
    }
  }

  return tables
}

/**
 * Reduces a cell to its readable text: link labels, no references, no
 * templates, no markup.
 */
export function cleanCell(raw: string): string {
  return (
    raw
      // References carry citation soup that is never part of a title.
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      // {{sort|key|display}} renders as just `display` — used on UFC's page
      // so its sortable table orders "UFC 2" before "UFC 10" numerically
      // instead of lexically. Handled before the generic template strip
      // below (which would otherwise delete the whole thing, key and
      // display alike): confirmed live, this silently dropped all 99 of
      // UFC's early, three-digit-padded numbered events (UFC 1–99) with no
      // error, since the row's name cell came out empty. `display` is
      // unwrapped here, before the `[[…]]` handling below, since it still
      // carries raw wikilink syntax (e.g. `[[UFC 1|UFC 1: The Beginning]]`).
      .replace(/\{\{sort\|[^|{}]*\|([\s\S]*?)\}\}/gi, '$1')
      // [[Page|Label]] shows the label; [[Page]] shows the page.
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\{\{[^{}]*\}\}/g, '')
      .replace(/''+/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

export interface WikiRow {
  cells: string[]
  headers: string[]
  /** Unparsed row, so a caller can still find things cleaning would remove. */
  raw: string
}

/** Reads one table into header names and cleaned row cells. */
export function parseTable(table: string): WikiRow[] {
  const lines = table.split('\n')
  const rows: { cells: string[]; raw: string }[] = []
  let headers: string[] = []
  // A `|-` finalizes the header block once headers already has content, so
  // any `!` line seen afterward is a per-row cell rather than more header —
  // see the note below. `current === null` alone can't tell the two apart:
  // some pages (WWE's) open with an empty leading `|-` before the real
  // header line, so `current` is already non-null by the time headers start.
  let headersComplete = false
  let current: string[] | null = null
  let currentRaw: string[] = []

  const pushCells = (line: string, separator: string, into: string[]) => {
    // A line may hold one cell, or several joined by || (or !! in a header).
    for (const part of line.split(separator)) {
      const cell = part.replace(/^[|!]/, '')
      // Cell attributes are separated from content by a single pipe.
      const withoutAttributes = /^[^|[{]*\|(?!\|)/.test(cell)
        ? cell.slice(cell.indexOf('|') + 1)
        : cell
      into.push(cleanCell(withoutAttributes))
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('{|') || trimmed.startsWith('|}')) continue

    if (trimmed.startsWith('|-')) {
      if (current && current.length > 0) rows.push({ cells: current, raw: currentRaw.join('\n') })
      if (headers.length > 0) headersComplete = true
      current = []
      currentRaw = []
      continue
    }

    if (trimmed.startsWith('!')) {
      // Until headers are complete, a `!` line is real column-header
      // content. Afterward, a `!` line is a MediaWiki `scope="row"` cell —
      // a per-row header used for styling (the AEW page's tables,
      // `class="plainrowheaders"`), not a second header row. Confirmed
      // live: routing it into `headers` unconditionally left every row one
      // cell short of the real header count, so every row failed the
      // header/cell-count alignment check downstream and the whole table
      // silently produced zero events.
      if (!headersComplete) {
        pushCells(trimmed, '!!', headers)
      } else {
        current ??= []
        currentRaw.push(line)
        pushCells(trimmed, '!!', current)
      }
      continue
    }

    if (trimmed.startsWith('|')) {
      current ??= []
      currentRaw.push(line)
      pushCells(trimmed, '||', current)
    }
  }

  if (current && current.length > 0) rows.push({ cells: current, raw: currentRaw.join('\n') })

  // Some pages put headers in the first body row instead of using `!`.
  if (headers.length === 0 && rows.length > 0) headers = rows.shift()!.cells

  return rows.map((row) => ({ cells: row.cells, headers, raw: row.raw }))
}

/**
 * First four-digit year mentioned in a row.
 *
 * Read from the raw text because dates are usually templates ({{dts|2026|...}})
 * and cleaning strips them entirely. Used only to spot a table written newest
 * first, not as a real date.
 */
export function rowYear(raw: string): number | undefined {
  const match = /\b(1[89]\d{2}|20\d{2})\b/.exec(raw)

  return match ? Number(match[1]) : undefined
}

/** Finds a column by header name, so column order does not have to be known. */
export function columnIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => {
    const normalized = header.toLowerCase().trim()

    return candidates.some((candidate) => normalized === candidate || normalized.startsWith(candidate))
  })
}
