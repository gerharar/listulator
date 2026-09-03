import { getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { columnIndex, extractTables, parseTable, rowYear, splitSections } from './wikitext.js'

/**
 * Wikipedia "List of … events" pages, for wrestling and MMA.
 *
 * These are the categories with no usable API at all: HowLongToBeat-style
 * dead ends everywhere. profightdb has a broken certificate, cagematch's
 * robots.txt disallows the database it keeps its events in, and Sherdog has no
 * API. Wikipedia keeps the same data in maintained tables, free, keyless and
 * fixable when it is wrong.
 */

const API = 'https://en.wikipedia.org/w/api.php'

/** Column headers that name the event, across the pages we support. */
const EVENT_HEADERS = ['event', 'name', 'show', 'title', 'card']

/** Sections listing things that have not happened; you cannot finish those. */
const FUTURE_SECTIONS = /scheduled|upcoming|future|announced/i

/**
 * Sections that are commentary rather than event listings. Without this the
 * "Number of events by year" table on the UFC page becomes a list of years.
 */
const NON_EVENT_SECTIONS =
  /number of events|by year|locations|themed|recurring|see also|references|external links|notes/i

export interface Promotion {
  key: string
  name: string
  /** Exact Wikipedia page title. Not user input — see the note in `expand`. */
  page: string
  detail: string
}

export const WRESTLING_PROMOTIONS: readonly Promotion[] = [
  {
    key: 'wwe',
    name: 'WWE pay-per-views',
    page: 'List of WWE pay-per-view and livestreaming supercards',
    detail: 'WWF/WWE · every PPV and supercard',
  },
  {
    key: 'aew',
    name: 'AEW pay-per-views',
    page: 'List of All Elite Wrestling pay-per-view events',
    detail: 'All Elite Wrestling',
  },
  {
    key: 'tna',
    name: 'TNA pay-per-views',
    page: 'List of TNA pay-per-view and livestreaming events',
    detail: 'TNA / Impact Wrestling',
  },
  {
    key: 'roh',
    name: 'ROH pay-per-views',
    page: 'List of Ring of Honor pay-per-view and livestreaming events',
    detail: 'Ring of Honor',
  },
]

export const MMA_PROMOTIONS: readonly Promotion[] = [
  { key: 'ufc', name: 'UFC events', page: 'List of UFC events', detail: 'Every UFC event' },
  {
    key: 'bellator',
    name: 'Bellator events',
    page: 'List of Bellator MMA events',
    detail: 'Bellator MMA',
  },
  {
    key: 'pfl',
    name: 'PFL events',
    page: 'List of Professional Fighters League events',
    detail: 'Professional Fighters League',
  },
]

interface ParseResponse {
  parse?: { wikitext?: { '*'?: string } }
  error?: { info?: string }
}

export function createWikipediaEventsAdapter(
  promotions: readonly Promotion[],
  fetchImpl?: FetchLike,
): SearchAdapter {
  return {
    // Wikipedia needs no credentials.
    isAvailable: () => true,

    async search(query) {
      const term = query.trim().toLowerCase()

      // Matched against a fixed set rather than searching Wikipedia at large:
      // these are the pages whose tables are known to parse, and an arbitrary
      // page would mostly produce junk.
      return promotions
        .filter(
          (promotion) =>
            promotion.key.includes(term) ||
            promotion.name.toLowerCase().includes(term) ||
            promotion.detail.toLowerCase().includes(term),
        )
        .map(
          (promotion): ListSource => ({
            externalRef: `promotion:${promotion.key}`,
            title: promotion.name,
            detail: promotion.detail,
          }),
        )
    },

    async expand(externalRef) {
      const [kind, key] = externalRef.split(':')
      if (kind !== 'promotion' || !key) return []

      // Looked up by key rather than taking a page title from the caller, so
      // this can only ever fetch pages the app ships with.
      const promotion = promotions.find((candidate) => candidate.key === key)
      if (!promotion) return []

      const response = await getJson<ParseResponse>(
        `${API}?action=parse&format=json&redirects=1&prop=wikitext&page=${encodeURIComponent(promotion.page)}`,
        { source: 'Wikipedia', ...(fetchImpl ? { fetchImpl } : {}) },
      )

      const wikitext = response.parse?.wikitext?.['*']
      if (!wikitext) return []

      const events: MediaTypeCandidate[] = []
      const seen = new Set<string>()

      for (const section of splitSections(wikitext)) {
        if (FUTURE_SECTIONS.test(section.heading)) continue
        if (NON_EVENT_SECTIONS.test(section.heading)) continue

        // Pages like WWE's are split into a section per year, and the year
        // appears nowhere in the row. Without it every annual Royal Rumble
        // collapses to one entry.
        const sectionYear = /^(19|20)\d{2}$/.test(section.heading.trim())
          ? section.heading.trim()
          : undefined

        // Cards are announced a year or more ahead, and a section for next
        // year is a list of things nobody can have watched — the same reason
        // unreleased films and games are left out.
        if (sectionYear && Number(sectionYear) > new Date().getFullYear()) continue

        for (const table of extractTables(section.body)) {
          const rows = parseTable(table)
          if (rows.length === 0) continue

          const headers = rows[0]!.headers
          const nameColumn = columnIndex(headers, EVENT_HEADERS)
          if (nameColumn === -1) continue

          // A row with a spanned cell has fewer cells than the header, which
          // shifts every later column left — that is how "Los Angeles,
          // California" ended up being imported as an event. Rather than
          // implement rowspan, mismatched rows are skipped: losing a row is
          // better than inventing a wrong one.
          const aligned = rows.filter((row) => row.cells.length === headers.length)

          // Some tables are written newest first (the UFC page's "Past
          // events" is), which would import a career backwards.
          const firstYear = rowYear(aligned[0]?.raw ?? '')
          const lastYear = rowYear(aligned[aligned.length - 1]?.raw ?? '')
          const ordered =
            firstYear && lastYear && firstYear > lastYear ? [...aligned].reverse() : aligned

          for (const row of ordered) {
            const name = row.cells[nameColumn]
            if (!name) continue

            const title = sectionYear ? `${name} (${sectionYear})` : name

            // The same event can appear in more than one table on a page.
            const key = title.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)

            events.push({ title })
          }
        }
      }

      // Document order is otherwise chronological on these pages, and is kept
      // rather than parsed from dates: the WWE page writes "March 31" with the
      // year only in the section heading, so a date column cannot stand alone.
      return events
    },
  }
}
