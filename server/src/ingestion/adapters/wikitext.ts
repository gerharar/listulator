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
  /** How many `=` the heading has: 2 for `== Heading ==`, 3 for `=== Sub ===`. 0 for the lead. */
  level: number
}

const isLineBreak = (code: number): boolean => code === 10 || code === 13 || code === 0x2028 || code === 0x2029

/** JavaScript's `\s`, which is what the pattern this replaced used. */
function isSpace(code: number): boolean {
  return (
    code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
  )
}

/**
 * The heading a line holds, or undefined: two or more `=`, the title, two or more `=`, and nothing but spaces after. Read with a
 * look at each end of the line rather than the pattern `^(==+)\s*(.+?)\s*==+\s*$`, which tried every end for the title and
 * scanned on to the end of the line each time: a line of `== a` and 64 KB of spaces took it 4.8 s (SR-024). A line of nothing but
 * `=` has no heading (the pattern found one in `=====` by splitting the run, which no page means).
 */
function headingOf(text: string, from: number, to: number): { heading: string; level: number } | undefined {
  let end = to
  while (end > from && isSpace(text.charCodeAt(end - 1))) end -= 1

  let level = 0
  while (from + level < end && text.charCodeAt(from + level) === 61) level += 1
  if (level < 2) return undefined

  let closing = 0
  while (end - closing > from + level && text.charCodeAt(end - closing - 1) === 61) closing += 1
  if (closing < 2) return undefined

  let start = from + level
  let stop = end - closing
  while (start < stop && isSpace(text.charCodeAt(start))) start += 1
  while (stop > start && isSpace(text.charCodeAt(stop - 1))) stop -= 1
  if (start === stop) return undefined

  return { heading: text.slice(start, stop), level }
}

/** Splits a page on its `== Heading ==` lines, keeping the lead as "". Linear in the length of the page. */
export function splitSections(wikitext: string): WikiSection[] {
  const sections: WikiSection[] = []
  let lastHeading = ''
  let lastLevel = 0
  let lastIndex = 0

  for (let lineStart = 0; lineStart <= wikitext.length; ) {
    let lineEnd = lineStart
    while (lineEnd < wikitext.length && !isLineBreak(wikitext.charCodeAt(lineEnd))) lineEnd += 1

    const found = headingOf(wikitext, lineStart, lineEnd)
    if (found) {
      sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex, lineStart), level: lastLevel })
      lastHeading = found.heading
      lastLevel = found.level
      lastIndex = lineEnd
    }

    lineStart = lineEnd + 1
  }

  sections.push({ heading: lastHeading, body: wikitext.slice(lastIndex), level: lastLevel })

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
 * The most of one cell that is read. A real cell, citations included, is a few kilobytes; the rest of an oversized one is dropped,
 * so a hostile page costs a bounded amount per cell even before the linear reader below (SR-024).
 */
export const CELL_MAX_CHARS = 20_000

/** `needle` (lower-case ASCII) at `at`, whatever the case of the text. */
function matchesAt(text: string, at: number, needle: string): boolean {
  for (let k = 0; k < needle.length; k += 1) {
    const code = text.charCodeAt(at + k)
    const want = needle.charCodeAt(k)
    if (code !== want && !(want >= 97 && want <= 122 && (code | 32) === want)) return false
  }

  return true
}

/** The first `needle` at or after `from`, whatever the case of the text; -1 if none. */
function indexOfIgnoringCase(text: string, needle: string, from: number): number {
  const last = text.length - needle.length
  for (let at = from; at <= last; at += 1) if (matchesAt(text, at, needle)) return at

  return -1
}

/**
 * The text with each span a pass finds replaced, where `find` is handed the text and where to look from and answers the span's
 * start, end and replacement, or `undefined` for "none from here on". Every pass below advances through the text once: where its
 * pattern fails at one start, the reason is shared by every start before the point it looked as far as (the same closing mark is
 * missing, or the same next `>` does not end in `/`), so they are skipped. The regexes these replace tried every start and
 * scanned to the end of the text from each, and took seconds on 64 KB (SR-024).
 */
function replaceSpans(
  text: string,
  find: (from: number) => { start: number; end: number; replacement: string; resume?: number } | { skipTo: number } | undefined,
): string {
  let out = ''
  let copied = 0
  let from = 0

  for (;;) {
    const found = find(from)
    if (!found) break
    if ('skipTo' in found) {
      from = found.skipTo
      continue
    }
    out += text.slice(copied, found.start) + found.replacement
    copied = found.end
    from = found.end
  }

  return out + text.slice(copied)
}

/** `<ref … />`: the first `>` after the opener, if it is preceded by `/`. */
function withoutSelfClosingRefs(text: string): string {
  return replaceSpans(text, (from) => {
    const start = indexOfIgnoringCase(text, '<ref', from)
    if (start < 0) return undefined
    const close = text.indexOf('>', start + 4)
    if (close < 0) return undefined
    // `<ref>` is not self-closing: the character before its `>` is the `f`.
    if (text.charCodeAt(close - 1) === 47) return { start, end: close + 1, replacement: '' }

    return { skipTo: close + 1 }
  })
}

/** `<ref …>` to the first `</ref>` after it. */
function withoutRefs(text: string): string {
  return replaceSpans(text, (from) => {
    const start = indexOfIgnoringCase(text, '<ref', from)
    if (start < 0) return undefined
    const close = text.indexOf('>', start + 4)
    if (close < 0) return undefined
    const end = indexOfIgnoringCase(text, '</ref>', close + 1)
    if (end < 0) return undefined

    return { start, end: end + 6, replacement: '' }
  })
}

/** Any `<…>` with something inside. */
function withoutTags(text: string): string {
  return replaceSpans(text, (from) => {
    const start = text.indexOf('<', from)
    if (start < 0) return undefined
    const close = text.indexOf('>', start + 1)
    if (close < 0) return undefined
    if (close === start + 1) return { skipTo: start + 1 }

    return { start, end: close + 1, replacement: '' }
  })
}

/** `{{sort|key|display}}` becomes `display`. */
function withSortTemplatesUnwrapped(text: string): string {
  return replaceSpans(text, (from) => {
    const start = indexOfIgnoringCase(text, '{{sort|', from)
    if (start < 0) return undefined
    let bar = start + 7
    while (bar < text.length && text[bar] !== '|' && text[bar] !== '{' && text[bar] !== '}') bar += 1
    if (text[bar] !== '|') return { skipTo: start + 1 }
    const end = text.indexOf('}}', bar + 1)
    if (end < 0) return undefined

    return { start, end: end + 2, replacement: text.slice(bar + 1, end) }
  })
}

/**
 * `[[Page|Label]]` becomes `Label` (`piped`), or `[[Page]]` becomes `Page`. The next `]` and the next `|` are found once and kept
 * while they are still ahead of the opener, so a long run of openers costs one search, not one each.
 */
function withLinksUnwrapped(text: string, piped: boolean): string {
  let close = -2
  let bar = -2

  return replaceSpans(text, (from) => {
    const start = text.indexOf('[[', from)
    if (start < 0) return undefined
    const body = start + 2
    if (close !== -1 && close < body) close = text.indexOf(']', body)
    if (close === -1) return undefined
    if (piped && bar !== -1 && bar < body) bar = text.indexOf('|', body)

    const closed = text.charCodeAt(close + 1) === 93
    if (piped) {
      // A target that does not start with `|`, a `|`, and a label with something in it.
      if (closed && bar > body && bar < close && close > bar + 1) return { start, end: close + 2, replacement: text.slice(bar + 1, close) }
    } else if (closed && close > body) {
      return { start, end: close + 2, replacement: text.slice(body, close) }
    }

    return { skipTo: start + 1 }
  })
}

/**
 * Reduces a cell to its readable text: link labels, no references, no
 * templates, no markup. Linear in the length of the cell; `cleanCell` is this
 * with the cell cut at `CELL_MAX_CHARS`.
 */
export function cleanMarkup(raw: string): string {
  // References carry citation soup that is never part of a title.
  let text = withoutRefs(withoutSelfClosingRefs(raw))
    .replace(/<br\s*\/?>/gi, ' ')
  text = withoutTags(text)
  // {{sort|key|display}} renders as just `display` — used on UFC's page
  // so its sortable table orders "UFC 2" before "UFC 10" numerically
  // instead of lexically. Handled before the generic template strip
  // below (which would otherwise delete the whole thing, key and
  // display alike): confirmed live, this silently dropped all 99 of
  // UFC's early, three-digit-padded numbered events (UFC 1–99) with no
  // error, since the row's name cell came out empty. `display` is
  // unwrapped here, before the `[[…]]` handling below, since it still
  // carries raw wikilink syntax (e.g. `[[UFC 1|UFC 1: The Beginning]]`).
  text = withSortTemplatesUnwrapped(text)
  // [[Page|Label]] shows the label; [[Page]] shows the page.
  text = withLinksUnwrapped(withLinksUnwrapped(text, true), false)

  return text
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/''+/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reduces a cell to its readable text; a cell over `CELL_MAX_CHARS` is read up to there. */
export function cleanCell(raw: string): string {
  return cleanMarkup(raw.length > CELL_MAX_CHARS ? raw.slice(0, CELL_MAX_CHARS) : raw)
}

export interface WikiRow {
  cells: string[]
  headers: string[]
  /** Unparsed row, so a caller can still find things cleaning would remove. */
  raw: string
}

interface RawCell {
  value: string
  /** `rowspan=N` (or `rowspan="N"`) on the cell's own attributes; 1 if absent. */
  rowspan: number
}

/**
 * A cell's leading `attr=value ...|` segment, same boundary the original
 * single-purpose regex used, but capturing the attributes text too so a
 * `rowspan` can be read out of it before the whole prefix is discarded.
 */
function parseCell(part: string): RawCell {
  const cell = part.replace(/^[|!]/, '')
  const attrs = /^([^|[{]*)\|(?!\|)/.exec(cell)
  if (!attrs) return { value: cleanCell(cell), rowspan: 1 }

  const span = /rowspan\s*=\s*"?(\d+)"?/i.exec(attrs[1]!)
  return {
    value: cleanCell(cell.slice(attrs[0].length)),
    rowspan: span ? Number(span[1]) : 1,
  }
}

/**
 * Tracks a `rowspan`-declaring cell so later rows can inherit its value at
 * the same column position — MediaWiki's own meaning of `rowspan=N`: the
 * declaring row plus the next N-1 rows all share one cell.
 */
interface ActiveSpan {
  value: string
  /** Rows still owed this value, not counting the declaring row itself. */
  remaining: number
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
  let current: RawCell[] | null = null
  let currentRaw: string[] = []
  // Column index -> the rowspan currently covering it, persisting across
  // `|-` boundaries until it's been inherited its declared number of times.
  // Reset per table (never per row) — a fresh `parseTable` call per `{| … |}`
  // block already gives each table its own instance of this map.
  const activeSpans = new Map<number, ActiveSpan>()

  const pushCells = (line: string, separator: string, into: RawCell[]) => {
    // A line may hold one cell, or several joined by || (or !! in a header).
    for (const part of line.split(separator)) into.push(parseCell(part))
  }

  /**
   * Rebuilds one row's full cell list by column position: a column still
   * covered by an earlier row's `rowspan` gets that row's value without
   * consuming one of this row's own cells; every other column consumes the
   * next actual cell this row has, in order. `headers.length` is fixed
   * (real column count) by the time any data row reaches this — headers are
   * always complete before the first data row starts.
   *
   * Confirmed live against the real UFC page: 157 of ~789 rows (venues and
   * locations shared across a run of events via `rowspan`) were previously
   * dropped by the plain cell-count alignment check downstream — not a rare
   * edge case, roughly one row in five. Reconstructing by column, rather
   * than lengthening the raw cell list, is what keeps a spanned Attendance
   * or Ref value from sliding into the Venue/Location slot it isn't.
   */
  function finalizeCurrentRow(): void {
    if (!current) return

    const width = headers.length > 0 ? headers.length : current.length
    const cells: string[] = []
    let cellIndex = 0

    for (let column = 0; column < width; column += 1) {
      const span = activeSpans.get(column)
      if (span && span.remaining > 0) {
        cells.push(span.value)
        span.remaining -= 1
        if (span.remaining === 0) activeSpans.delete(column)
        continue
      }

      const cell = current[cellIndex]
      if (!cell) break // Genuinely short row — left to the caller's own alignment check.
      cells.push(cell.value)
      if (cell.rowspan > 1) activeSpans.set(column, { value: cell.value, remaining: cell.rowspan - 1 })
      cellIndex += 1
    }

    if (cells.length > 0) rows.push({ cells, raw: currentRaw.join('\n') })
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('{|') || trimmed.startsWith('|}')) continue

    if (trimmed.startsWith('|-')) {
      finalizeCurrentRow()
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
        for (const part of trimmed.split('!!')) headers.push(parseCell(part).value)
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

  finalizeCurrentRow()

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
