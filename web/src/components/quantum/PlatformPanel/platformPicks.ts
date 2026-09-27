import { PLATFORM_ORDER, platformCode, platformName } from '../../../../../server/src/catalog/platforms.js'

/**
 * The Platform panel's logic (U5, design: docs/chips): what it offers, how a
 * pick changes the selection, and what it remembers. Pure, so the panel is
 * only layout. The registry is `config/platforms.csv` as generated; its file
 * order is the design's popularity rank (owner: no data from the handoff).
 * The design's Multi-platform row is dropped (owner, U5): a game on several
 * platforms names them; nothing else says "multi".
 */

/** How many search matches are shown before "keep typing". */
export const MATCH_CAP = 30

/** Every platform in the table, as codes, most common first. */
const ALL: readonly string[] = PLATFORM_ORDER.map((key) => platformCode(key))
const RANK = new Map(ALL.map((code, index) => [code, index]))
/** How many platforms the table has: the search box and the browse footer say it. */
export const PLATFORM_COUNT = ALL.length

const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export interface PanelSection {
  key: 'inList' | 'common' | 'matches'
  codes: string[]
  /** Matches only: how many there are in all. */
  total?: number
}

export interface PanelContent {
  sections: PanelSection[]
  /** Matches beyond the thirty shown. */
  hidden: number
  noMatch: boolean
}

/** A tag as a code the table knows, or undefined for a tag it does not know. */
function tableCode(tag: string): string | undefined {
  const code = platformCode(tag)
  return RANK.has(code) ? code : undefined
}

/**
 * What the panel lists (design §3). Nothing typed: what this list uses, then
 * the most common (ten, or six once the list has platforms) — ~190 platforms
 * can't be browsed. Both read A–Z (owner). The design's Recent section is
 * dropped (owner, U5: one more list is too much). Typed: one ranked section
 * of matches — the code itself, a code starting with the text, a name starting
 * with it, a word of the name starting with it, a name containing it — ties
 * A–Z, thirty shown.
 */
export function panelContent(query: string, inList: readonly string[]): PanelContent {
  const q = query.trim().toLowerCase()

  if (!q) {
    const used = [...new Set(inList.map(tableCode).filter((code) => code !== undefined))].sort(byCode)
    const taken = new Set(used)
    const common = ALL.filter((code) => !taken.has(code))
      .slice(0, used.length > 0 ? 6 : 10)
      .sort(byCode)

    const sections: PanelSection[] = []
    if (used.length > 0) sections.push({ key: 'inList', codes: used })
    sections.push({ key: 'common', codes: common })
    return { sections, hidden: 0, noMatch: false }
  }

  const score = (code: string): number => {
    const c = code.toLowerCase()
    const name = (platformName(code) ?? '').toLowerCase()
    if (c === q) return 0
    if (c.startsWith(q)) return 1
    if (name.startsWith(q)) return 2
    if (` ${name}`.includes(` ${q}`)) return 3
    if (name.includes(q)) return 4
    return -1
  }
  const hits = ALL.map((code) => ({ code, score: score(code) }))
    .filter((hit) => hit.score >= 0)
    .sort((a, b) => a.score - b.score || byCode(a.code, b.code))
  const sections: PanelSection[] =
    hits.length > 0
      ? [{ key: 'matches', codes: hits.slice(0, MATCH_CAP).map((hit) => hit.code), total: hits.length }]
      : []

  return { sections, hidden: Math.max(hits.length - MATCH_CAP, 0), noMatch: hits.length === 0 }
}

/** Codes in the table's order (the design's rank), unknown tags after, as they came. */
function inTableOrder(codes: readonly string[]): string[] {
  const known = codes.filter((code) => RANK.has(code)).sort((a, b) => RANK.get(a)! - RANK.get(b)!)
  return [...known, ...codes.filter((code) => !RANK.has(code))]
}

/** One click in the panel: the platform toggles in or out; the result is always in the table's order. */
export function togglePlatform(selected: readonly string[], code: string): string[] {
  return inTableOrder(selected.includes(code) ? selected.filter((entry) => entry !== code) : [...selected, code])
}

/**
 * An item's tags as the panel's starting selection: today's codes (PC → WIN),
 * once each, in the table's order. A tag the table does not know (a bare multi
 * among them) is kept after the rest, so saving never drops it.
 */
export function platformDraft(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return []
  return inTableOrder([...new Set(tags.map((tag) => platformCode(tag)))])
}
