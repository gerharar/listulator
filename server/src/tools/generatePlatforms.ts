import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Turns the owner's platform file (`config/platforms.csv`: IGDB id; full name;
 * shortcode) into `catalog/platforms.generated.ts`, a plain module the browser,
 * the desktop app and the server all import (10.24c). The CSV is the source of
 * truth; the generated file is committed, and a test fails when the two differ.
 *
 * Parsing is deliberately strict rather than a general CSV reader: semicolons,
 * CRLF or LF, an optional BOM (a spreadsheet save adds one), exactly three
 * fields, no quotes. A malformed line is refused with its line number.
 */

const CSV_PATH = fileURLToPath(new URL('../../../config/platforms.csv', import.meta.url))
const OUT_PATH = fileURLToPath(new URL('../catalog/platforms.generated.ts', import.meta.url))
const HEADER = 'igdb_id;name;abbreviation'

export interface PlatformRow {
  igdbId: number
  name: string
  code: string
}

export interface PlatformTable {
  /** One entry per code, in the order of its first row: the Platform filter's order. */
  table: { code: string; name: string }[]
  /** IGDB platform id → code. */
  igdb: Record<number, string>
}

export function parsePlatformsCsv(text: string): PlatformRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0] !== HEADER) throw new Error(`config/platforms.csv: the header must be "${HEADER}"`)

  const rows: PlatformRow[] = []
  lines.slice(1).forEach((line, index) => {
    if (line === '') return
    const at = `config/platforms.csv line ${index + 2}`
    const fields = line.split(';')
    if (fields.length !== 3) throw new Error(`${at}: expected 3 fields, found ${fields.length}`)
    if (line.includes('"')) throw new Error(`${at}: quotes are not allowed`)
    const [id, name, code] = fields as [string, string, string]
    if (!/^\d+$/.test(id)) throw new Error(`${at}: "${id}" is not an IGDB id`)
    if (name !== name.trim() || code !== code.trim()) throw new Error(`${at}: spaces around a name or code`)
    if (!name || !code) throw new Error(`${at}: the name and the code are both required`)
    if (code !== code.toUpperCase()) throw new Error(`${at}: the code "${code}" must be in capitals`)
    rows.push({ igdbId: Number(id), name, code })
  })

  return rows
}

export function buildPlatformTable(rows: readonly PlatformRow[]): PlatformTable {
  const firstLine = new Map<string, { code: string; name: string; line: number }>()
  const seenIds = new Set<number>()
  const table: PlatformTable['table'] = []
  const igdb: PlatformTable['igdb'] = {}

  rows.forEach((row, index) => {
    const line = index + 2
    if (seenIds.has(row.igdbId)) throw new Error(`config/platforms.csv line ${line}: IGDB id ${row.igdbId} appears twice`)
    seenIds.add(row.igdbId)

    const key = row.code.toLowerCase()
    const first = firstLine.get(key)
    if (first) {
      if (first.code !== row.code) {
        throw new Error(`config/platforms.csv: code ${first.code} is written ${row.code} on line ${line} (line ${first.line} has ${first.code})`)
      }
      if (first.name !== row.name) {
        throw new Error(
          `config/platforms.csv: code ${row.code} has two names, "${first.name}" on line ${first.line} and "${row.name}" on line ${line}`,
        )
      }
    } else {
      firstLine.set(key, { code: row.code, name: row.name, line })
      table.push({ code: row.code, name: row.name })
    }
    igdb[row.igdbId] = row.code
  })

  return { table, igdb }
}

export function renderPlatformsModule({ table, igdb }: PlatformTable): string {
  const entries = table.map(({ code, name }) => `  { code: ${JSON.stringify(code)}, name: ${JSON.stringify(name)} },`)
  const ids = Object.keys(igdb)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => `  ${id}: ${JSON.stringify(igdb[id])},`)

  return [
    '// Generated from config/platforms.csv by `npm run platforms:generate -w server`. Do not edit by hand.',
    '',
    '/** Every platform code, in the Platform filter\'s order, with its full name. */',
    'export const PLATFORM_TABLE: readonly { code: string; name: string }[] = [',
    ...entries,
    ']',
    '',
    '/** IGDB platform id → code. */',
    'export const IGDB_PLATFORM_CODES: Readonly<Record<number, string>> = {',
    ...ids,
    '}',
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = buildPlatformTable(parsePlatformsCsv(readFileSync(CSV_PATH, 'utf8')))
  writeFileSync(OUT_PATH, renderPlatformsModule(built))
  console.log(`Wrote ${built.table.length} codes and ${Object.keys(built.igdb).length} IGDB ids to ${OUT_PATH}`)
}
