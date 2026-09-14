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
  {
    key: 'wcw',
    name: 'WCW pay-per-views',
    page: 'List of WCW pay-per-view events',
    detail: 'World Championship Wrestling',
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

/**
 * A curated, named subset of one promotion's events — "just WrestleMania,"
 * not all of WWE. Deliberately not free-text: each entry is hand-picked and
 * matched with a simple rule against the parent promotion's own already-
 * fetched event titles, never against Wikipedia at large (task 6.8;
 * docs/DECISIONS.md has the real-title verification behind each rule).
 */
export interface SubSeries {
  key: string
  /** Must match a `Promotion.key` in the same list passed to the adapter. */
  promotionKey: string
  /** Full display title, e.g. "All WrestleMania PPVs (WWF/WWE)" — also what search matches against. */
  title: string
  /** Tested against each of the promotion's own event titles, post-fetch. */
  matches: (eventTitle: string) => boolean
}

const contains = (needle: string) => (title: string) => title.toLowerCase().includes(needle)
const startsWith = (prefix: string) => (title: string) => title.toLowerCase().startsWith(prefix)

/**
 * Matches a show whose title is the *same string* every time it recurs
 * (e.g. "Backlash", "King of the Ring") — as opposed to WrestleMania or "In
 * Your House", where each edition's title differs and a `contains`/
 * `startsWith` rule is needed instead. `exactly` strips the "(YYYY)" suffix
 * this adapter appends for year-sectioned pages before comparing, so it
 * matches on the real event name rather than a stray digit run.
 *
 * Exact match matters here, not substring: "Vengeance" and "Vengeance Day"
 * are two different real shows sharing 47 letters — a `contains` rule would
 * wrongly fold Vengeance Day's editions into Vengeance's count.
 */
const exactly = (name: string) => (title: string) =>
  title
    .replace(/\s*\(\d{4}\)$/, '')
    .trim()
    .toLowerCase() === name.toLowerCase()

/**
 * "UFC 330: …" vs. "UFC Fight Night: …" vs. outliers that are neither
 * ("UFC: The Ultimate Ultimate", "UFC Japan: Ultimate Japan") — verified
 * against the real page. A plain substring on "UFC" would catch everything;
 * this needs "UFC" followed by a space and a digit specifically, which
 * excludes Fight Night and the named specials without an exclusion list.
 */
const numberedUfcEvent = (title: string) => /^ufc \d/.test(title.toLowerCase())

export const WWE_SUB_SERIES: readonly SubSeries[] = [
  {
    key: 'wrestlemania',
    promotionKey: 'wwe',
    title: 'All WrestleMania PPVs (WWF/WWE)',
    matches: contains('wrestlemania'),
  },
  {
    key: 'royal-rumble',
    promotionKey: 'wwe',
    title: 'All Royal Rumble PPVs (WWF/WWE)',
    matches: contains('royal rumble'),
  },
  {
    key: 'summerslam',
    promotionKey: 'wwe',
    title: 'All SummerSlam PPVs (WWF/WWE)',
    matches: contains('summerslam'),
  },
  {
    key: 'survivor-series',
    promotionKey: 'wwe',
    title: 'All Survivor Series PPVs (WWF/WWE)',
    matches: contains('survivor series'),
  },
  // Every other show recurring more than once on the real page (task 6.8
  // follow-up, 2026-09-13) — generated from a live fetch, not hand-typed,
  // then reviewed for cross-contamination (see docs/DECISIONS.md).
  {
    key: 'in-your-house',
    promotionKey: 'wwe',
    title: 'All In Your House PPVs (WWF/WWE)',
    // A prefix match, not `exactly`: most editions carry a subtitle
    // ("In Your House: Beware of Dog"), unlike the shows below. Confirmed
    // this does not also catch the unrelated "TakeOver: In Your House".
    matches: startsWith('in your house'),
  },
  {
    key: 'armageddon',
    promotionKey: 'wwe',
    title: 'All Armageddon PPVs (WWF/WWE)',
    matches: exactly('Armageddon'),
  },
  {
    key: 'backlash',
    promotionKey: 'wwe',
    title: 'All Backlash PPVs (WWF/WWE)',
    matches: exactly('Backlash'),
  },
  {
    key: 'bad-blood',
    promotionKey: 'wwe',
    title: 'All Bad Blood PPVs (WWF/WWE)',
    matches: exactly('Bad Blood'),
  },
  {
    key: 'battleground',
    promotionKey: 'wwe',
    title: 'All Battleground PPVs (WWF/WWE)',
    matches: exactly('Battleground'),
  },
  {
    key: 'bragging-rights',
    promotionKey: 'wwe',
    title: 'All Bragging Rights PPVs (WWF/WWE)',
    matches: exactly('Bragging Rights'),
  },
  {
    key: 'clash-at-the-castle',
    promotionKey: 'wwe',
    title: 'All Clash at the Castle PPVs (WWF/WWE)',
    matches: exactly('Clash at the Castle'),
  },
  {
    key: 'clash-of-champions',
    promotionKey: 'wwe',
    title: 'All Clash of Champions PPVs (WWF/WWE)',
    matches: exactly('Clash of Champions'),
  },
  {
    key: 'crown-jewel',
    promotionKey: 'wwe',
    title: 'All Crown Jewel PPVs (WWF/WWE)',
    matches: exactly('Crown Jewel'),
  },
  {
    key: 'cyber-sunday',
    promotionKey: 'wwe',
    title: 'All Cyber Sunday PPVs (WWF/WWE)',
    matches: exactly('Cyber Sunday'),
  },
  {
    key: 'deadline',
    promotionKey: 'wwe',
    title: 'All Deadline PPVs (WWF/WWE)',
    matches: exactly('Deadline'),
  },
  {
    key: 'elimination-chamber',
    promotionKey: 'wwe',
    title: 'All Elimination Chamber PPVs (WWF/WWE)',
    matches: exactly('Elimination Chamber'),
  },
  {
    key: 'evolution',
    promotionKey: 'wwe',
    title: 'All Evolution PPVs (WWF/WWE)',
    matches: exactly('Evolution'),
  },
  {
    key: 'extreme-rules',
    promotionKey: 'wwe',
    title: 'All Extreme Rules PPVs (WWF/WWE)',
    matches: exactly('Extreme Rules'),
  },
  {
    key: 'fastlane',
    promotionKey: 'wwe',
    title: 'All Fastlane PPVs (WWF/WWE)',
    matches: exactly('Fastlane'),
  },
  {
    key: 'fully-loaded',
    promotionKey: 'wwe',
    title: 'All Fully Loaded PPVs (WWF/WWE)',
    matches: exactly('Fully Loaded'),
  },
  {
    key: 'halloween-havoc',
    promotionKey: 'wwe',
    title: 'All Halloween Havoc PPVs (WWF/WWE)',
    matches: exactly('Halloween Havoc'),
  },
  {
    key: 'heatwave',
    promotionKey: 'wwe',
    title: 'All Heatwave PPVs (WWF/WWE)',
    matches: exactly('Heatwave'),
  },
  {
    key: 'hell-in-a-cell',
    promotionKey: 'wwe',
    title: 'All Hell in a Cell PPVs (WWF/WWE)',
    matches: exactly('Hell in a Cell'),
  },
  {
    key: 'insurrextion',
    promotionKey: 'wwe',
    title: 'All Insurrextion PPVs (WWF/WWE)',
    matches: exactly('Insurrextion'),
  },
  {
    key: 'judgment-day',
    promotionKey: 'wwe',
    title: 'All Judgment Day PPVs (WWF/WWE)',
    matches: exactly('Judgment Day'),
  },
  {
    key: 'king-of-the-ring',
    promotionKey: 'wwe',
    title: 'All King of the Ring PPVs (WWF/WWE)',
    matches: exactly('King of the Ring'),
  },
  {
    key: 'money-in-the-bank',
    promotionKey: 'wwe',
    title: 'All Money in the Bank PPVs (WWF/WWE)',
    matches: exactly('Money in the Bank'),
  },
  {
    key: 'new-years-revolution',
    promotionKey: 'wwe',
    title: "All New Year's Revolution PPVs (WWF/WWE)",
    matches: exactly("New Year's Revolution"),
  },
  {
    key: 'night-of-champions',
    promotionKey: 'wwe',
    title: 'All Night of Champions PPVs (WWF/WWE)',
    matches: exactly('Night of Champions'),
  },
  {
    key: 'no-mercy',
    promotionKey: 'wwe',
    title: 'All No Mercy PPVs (WWF/WWE)',
    matches: exactly('No Mercy'),
  },
  {
    key: 'no-way-out',
    promotionKey: 'wwe',
    title: 'All No Way Out PPVs (WWF/WWE)',
    matches: exactly('No Way Out'),
  },
  {
    key: 'one-night-stand',
    promotionKey: 'wwe',
    title: 'All One Night Stand PPVs (WWF/WWE)',
    matches: exactly('One Night Stand'),
  },
  {
    key: 'over-the-limit',
    promotionKey: 'wwe',
    title: 'All Over the Limit PPVs (WWF/WWE)',
    matches: exactly('Over the Limit'),
  },
  {
    key: 'payback',
    promotionKey: 'wwe',
    title: 'All Payback PPVs (WWF/WWE)',
    matches: exactly('Payback'),
  },
  {
    key: 'rebellion',
    promotionKey: 'wwe',
    title: 'All Rebellion PPVs (WWF/WWE)',
    matches: exactly('Rebellion'),
  },
  {
    key: 'saturday-nights-main-event',
    promotionKey: 'wwe',
    title: "All Saturday Night's Main Event PPVs (WWF/WWE)",
    matches: exactly("Saturday Night's Main Event"),
  },
  {
    key: 'stand-and-deliver',
    promotionKey: 'wwe',
    title: 'All Stand & Deliver PPVs (WWF/WWE)',
    matches: exactly('Stand & Deliver'),
  },
  {
    key: 'starrcade',
    promotionKey: 'wwe',
    title: 'All Starrcade PPVs (WWF/WWE)',
    matches: exactly('Starrcade'),
  },
  {
    key: 'super-showdown',
    promotionKey: 'wwe',
    title: 'All Super ShowDown PPVs (WWF/WWE)',
    matches: exactly('Super ShowDown'),
  },
  {
    key: 'survivor-series-wargames',
    promotionKey: 'wwe',
    title: 'All Survivor Series: WarGames PPVs (WWF/WWE)',
    matches: exactly('Survivor Series: WarGames'),
  },
  {
    key: 'taboo-tuesday',
    promotionKey: 'wwe',
    title: 'All Taboo Tuesday PPVs (WWF/WWE)',
    matches: exactly('Taboo Tuesday'),
  },
  {
    key: 'takeover-in-your-house',
    promotionKey: 'wwe',
    title: 'All TakeOver: In Your House PPVs (WWF/WWE)',
    matches: exactly('TakeOver: In Your House'),
  },
  {
    key: 'takeover-toronto',
    promotionKey: 'wwe',
    title: 'All TakeOver: Toronto PPVs (WWF/WWE)',
    matches: exactly('TakeOver: Toronto'),
  },
  {
    key: 'takeover-wargames',
    promotionKey: 'wwe',
    title: 'All TakeOver: WarGames PPVs (WWF/WWE)',
    matches: exactly('TakeOver: WarGames'),
  },
  {
    key: 'the-great-american-bash',
    promotionKey: 'wwe',
    title: 'All The Great American Bash PPVs (WWF/WWE)',
    matches: exactly('The Great American Bash'),
  },
  {
    key: 'tlc-tables-ladders-and-chairs',
    promotionKey: 'wwe',
    title: 'All TLC: Tables, Ladders & Chairs PPVs (WWF/WWE)',
    matches: exactly('TLC: Tables, Ladders & Chairs'),
  },
  {
    key: 'unforgiven',
    promotionKey: 'wwe',
    title: 'All Unforgiven PPVs (WWF/WWE)',
    matches: exactly('Unforgiven'),
  },
  {
    key: 'united-kingdom-championship-tournament',
    promotionKey: 'wwe',
    title: 'All United Kingdom Championship Tournament PPVs (WWF/WWE)',
    matches: exactly('United Kingdom Championship Tournament'),
  },
  {
    key: 'vengeance',
    promotionKey: 'wwe',
    title: 'All Vengeance PPVs (WWF/WWE)',
    matches: exactly('Vengeance'),
  },
  {
    key: 'vengeance-day',
    promotionKey: 'wwe',
    title: 'All Vengeance Day PPVs (WWF/WWE)',
    matches: exactly('Vengeance Day'),
  },
  {
    key: 'worlds-collide',
    promotionKey: 'wwe',
    title: 'All Worlds Collide PPVs (WWF/WWE)',
    matches: exactly('Worlds Collide'),
  },
  {
    key: 'wrestlepalooza',
    promotionKey: 'wwe',
    title: 'All Wrestlepalooza PPVs (WWF/WWE)',
    matches: exactly('Wrestlepalooza'),
  },
]

/**
 * "UFC Fight Night" itself is a branding that changed over time, confirmed
 * against the real page: event 1 (Aug 2005) is titled plain "UFC Ultimate
 * Fight Night" (no number — a piped wikilink whose display text carries no
 * numeral at all); events 2–5 are "UFC Ultimate Fight Night N"; only from
 * event 6 onward (Oct 2006) does UFC drop "Ultimate" to the now-familiar
 * "UFC Fight Night N". A plain `startsWith('ufc fight night')` matches only
 * the post-2006 era, silently excluding the first five (including the
 * unnumbered first one) from "All Fight Night events."
 */
const fightNightEvent = (title: string) => {
  const normalized = title.toLowerCase()
  return normalized.startsWith('ufc fight night') || normalized.startsWith('ufc ultimate fight night')
}

export const UFC_SUB_SERIES: readonly SubSeries[] = [
  {
    key: 'ufc-fight-night',
    promotionKey: 'ufc',
    title: 'All Fight Night events (UFC)',
    matches: fightNightEvent,
  },
  {
    key: 'ufc-numbered',
    promotionKey: 'ufc',
    title: 'All numbered events (UFC)',
    matches: numberedUfcEvent,
  },
]

/**
 * Fetches and parses one promotion's full event table — the shared core of
 * both a plain promotion expansion and a sub-series' filtered one, so the
 * sort/reversal/dedup logic (task 6.3) only exists once and a sub-series
 * inherits the same chronological guarantee automatically.
 */
async function fetchPromotionEvents(
  promotion: Promotion,
  fetchImpl?: FetchLike,
): Promise<MediaTypeCandidate[]> {
  const response = await getJson<ParseResponse>(
    // `origin=*` opts into CORS (task 5.3, docs/DECISIONS.md) — Wikipedia's
    // API sends no CORS headers at all without it, blocking every browser
    // origin including a Tauri webview's. Harmless server-side too.
    `${API}?action=parse&format=json&redirects=1&prop=wikitext&page=${encodeURIComponent(promotion.page)}&origin=*`,
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

        // The WWE case: the row itself says "March 31", with the year
        // only in the section heading — sectionYear wins where it
        // exists. Pages without year sections (UFC) fall back to
        // whatever year the row's own text carries.
        const year = sectionYear ? Number(sectionYear) : rowYear(row.raw)

        events.push({ title, ...(year ? { year } : {}) })
      }
    }
  }

  // Document order happens to be chronological on these pages today, but
  // nothing enforces it — a decade-by-decade page like WWE's could be
  // edited into a different section order without anything above
  // noticing. A stable sort by year makes the ordering an explicit
  // guarantee rather than a borrowed assumption about editors. Events
  // that share a year, or have none at all, keep their document-order
  // position: a bare year cannot place them any more precisely than that
  // (the WWE page writes "March 31" with the year only in the section
  // heading, so a full date is not available to sort by), and
  // `Array.prototype.sort` is a stable sort, so ties never move.
  return events.sort((a, b) => {
    if (a.year === undefined || b.year === undefined) return 0
    return a.year - b.year
  })
}

export function createWikipediaEventsAdapter(
  promotions: readonly Promotion[],
  fetchImpl?: FetchLike,
  subSeries: readonly SubSeries[] = [],
): SearchAdapter {
  return {
    // Wikipedia needs no credentials.
    isAvailable: () => true,

    async search(query) {
      const term = query.trim().toLowerCase()

      // Matched against a fixed set rather than searching Wikipedia at large:
      // these are the pages whose tables are known to parse, and an arbitrary
      // page would mostly produce junk.
      const promotionResults = promotions
        .filter(
          (promotion) =>
            promotion.key.includes(term) ||
            promotion.name.toLowerCase().includes(term) ||
            promotion.detail.toLowerCase().includes(term),
        )
        .map((promotion): ListSource => ({
          externalRef: `promotion:${promotion.key}`,
          title: promotion.name,
          detail: promotion.detail,
        }))

      // Same "curated, not free-text" rule as promotions: matched against
      // the sub-series' own key/title, never against Wikipedia at large.
      const subSeriesResults = subSeries
        .filter((series) => series.key.includes(term) || series.title.toLowerCase().includes(term))
        .map((series): ListSource => ({
          externalRef: `subseries:${series.key}`,
          title: series.title,
        }))

      return [...promotionResults, ...subSeriesResults]
    },

    async expand(externalRef) {
      const [kind, key] = externalRef.split(':')
      if (!key) return []

      if (kind === 'promotion') {
        // Looked up by key rather than taking a page title from the caller,
        // so this can only ever fetch pages the app ships with.
        const promotion = promotions.find((candidate) => candidate.key === key)
        return promotion ? fetchPromotionEvents(promotion, fetchImpl) : []
      }

      if (kind === 'subseries') {
        const series = subSeries.find((candidate) => candidate.key === key)
        if (!series) return []

        const promotion = promotions.find((candidate) => candidate.key === series.promotionKey)
        if (!promotion) return []

        // Same fetch and sort as a plain promotion, filtered afterward — a
        // sub-series inherits 6.3's chronological guarantee for free rather
        // than needing its own.
        const events = await fetchPromotionEvents(promotion, fetchImpl)

        return events.filter((event) => series.matches(event.title))
      }

      return []
    },
  }
}
