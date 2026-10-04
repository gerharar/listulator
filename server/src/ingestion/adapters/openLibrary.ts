import { MAX_LIST_ITEMS } from '../../catalog/limits.js'
import { dedupeByTitle } from '../dedupe.js'
import { ListTooLargeError } from '../expandSource.js'
import { delay, getJson, withRetries, type FetchLike } from '../http.js'
import { createRateLimiter, type RateLimiter } from '../rateLimiter.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'
import { itemsOnly } from '../expansion.js'

/**
 * Open Library: search an author, expand to their bibliography.
 *
 * No API key, and page counts come back with the search results rather than
 * costing a request each — so a bibliography arrives with real reading
 * estimates in one or two round trips.
 */

const BASE = 'https://openlibrary.org'
/**
 * Works asked for in one request. Open Library takes far more (a `limit` of 5,000 answered, live) but a page costs
 * its size: 1,000 works took 1.6 s and 10,000 took 16.7 s, so a thousand keeps each request short and a prolific
 * author (Isaac Asimov: 1,476 works) at two requests, where pages of a hundred were fifteen.
 */
const PAGE_SIZE = 1000
/**
 * The most works one author's listing reads, whatever the filters later keep: twenty pages, about half a minute.
 * An author with more (an "Anonymous" record holds many times this) is refused as too large, after one request.
 */
const MAX_WORKS_READ = 2 * MAX_LIST_ITEMS
/**
 * Open Library's documented rate is one request a second for an anonymous client, three for one that identifies
 * itself with a contact email or phone in its `User-Agent`. Ours names the project's repository, not a contact, so
 * it is the first; a little headroom on top.
 */
const REQUEST_INTERVAL_MS = 1100
/**
 * The line every Open Library request waits in, for the whole process: the desktop builds its adapters again for
 * each request. A client given its own `fetch` (a test) gets none.
 */
export const openLibraryRequestLimiter: RateLimiter = createRateLimiter(REQUEST_INTERVAL_MS)

/**
 * Minutes of reading per page.
 *
 * A trade paperback page runs about 275 words, and adult fiction reading sits
 * around 225 words a minute — so roughly 1.2 minutes a page, putting a
 * 300-page novel near six hours. A guess, but an auditable one, and it beats
 * giving every book the same flat number regardless of length.
 */
const MINUTES_PER_PAGE = 1.2

interface AuthorDoc {
  key: string
  name: string
  work_count?: number
  top_work?: string
}

interface AuthorSearchResponse {
  docs?: AuthorDoc[]
}

/**
 * Open Library's author search returns genuine duplicate database records
 * for the same real person (task 6.10 — verified live: "Stephen King"
 * returns 6 exact-name-matching records). Collapsed to the single
 * highest-`work_count` record among exact case-insensitive name matches,
 * *not* combined with other same-named-but-different people — verified live
 * that a fuzzy name search can also return genuinely unrelated authors (a
 * plain "Agatha Christie" search also surfaces G.K. Chesterton and Erle
 * Stanley Gardner), which a looser combine would wrongly fold in.
 *
 * Kept local to this adapter rather than in `../dedupe.ts`: no second
 * adapter has this failure mode today (MusicBrainz and TMDB's own
 * same-named results are already-disambiguated distinct entities, checked
 * live), so a shared interface would be premature.
 */
function collapseAuthorDuplicates(docs: AuthorDoc[]): AuthorDoc[] {
  const byName = new Map<string, AuthorDoc>()

  for (const doc of docs) {
    const key = doc.name.trim().toLowerCase()
    const existing = byName.get(key)

    if (!existing || (doc.work_count ?? 0) > (existing.work_count ?? 0)) {
      byName.set(key, doc)
    }
  }

  return [...byName.values()]
}

interface WorkSearchResponse {
  numFound?: number
  docs?: {
    title?: string
    number_of_pages_median?: number
    first_publish_year?: number
    /** ISO 639-2 (bibliographic) codes for every edition Open Library has of this work. */
    language?: string[]
  }[]
}

/** Sentinel stored on a candidate's `language` when kept despite no tag at all. */
const UNKNOWN = 'unknown'

/**
 * Human-readable label for a candidate's `tags` entry — mirrors
 * `web/src/lib/bookLanguage.ts`'s `BOOK_LANGUAGES`/`bookLanguageLabel()`
 * exactly (duplicated rather than shared: server and web are separate npm
 * workspaces with no shared package). Keep the two in sync by hand if
 * either changes — this is a curated display list, not Open Library's
 * full code set.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  eng: 'English',
  spa: 'Spanish',
  fre: 'French',
  ger: 'German',
  ita: 'Italian',
  por: 'Portuguese',
  dut: 'Dutch',
  rus: 'Russian',
  pol: 'Polish',
  swe: 'Swedish',
  nor: 'Norwegian',
  dan: 'Danish',
  fin: 'Finnish',
  jpn: 'Japanese',
  chi: 'Chinese',
  kor: 'Korean',
}

function languageTagLabel(code: string): string {
  if (code === UNKNOWN) return 'Unknown'
  return LANGUAGE_LABELS[code] ?? code.toUpperCase()
}

/**
 * A language filter (GUI option, book category only — never sent for any
 * other category) is strict by default: only a work actually tagged with
 * the wanted language survives. `includeUnknown` widens that to also keep
 * a work with no language metadata at all, for the real, verified-live case
 * where strict-only would lose too much — a lightly-catalogued author (e.g.
 * Lucinda Riley: 76 of 133 works carry no language tag at all on Open
 * Library, despite unmistakably non-English titles) has most of their
 * bibliography excluded by strict filtering.
 *
 * Returns the language to record on the surviving candidate (`undefined` —
 * no filter was active at all, `all`/no language given, matching every book
 * list built before this feature existed — or the matched code, or the
 * `UNKNOWN` sentinel), and `null` to mean "exclude this work".
 */
function classifyLanguage(
  bookLanguages: string[] | undefined,
  wanted: string | undefined,
  includeUnknown: boolean,
): string | undefined | null {
  if (!wanted || wanted === 'all') return undefined
  if (!bookLanguages || bookLanguages.length === 0) return includeUnknown ? UNKNOWN : null
  return bookLanguages.includes(wanted) ? wanted : null
}

export interface OpenLibraryClientOptions {
  /** Injectable so the waits between retries are testable without waiting. */
  sleep?: (ms: number) => Promise<void>
}

export function createOpenLibraryAdapter(
  fetchImpl?: FetchLike,
  /** One line for every request this adapter makes. By default the process-wide one; a client given its own `fetch` gets none. */
  limiter: RateLimiter | undefined = fetchImpl ? undefined : openLibraryRequestLimiter,
  { sleep = delay }: OpenLibraryClientOptions = {},
): SearchAdapter {
  const options = { source: 'Open Library', ...(fetchImpl ? { fetchImpl } : {}) }

  /**
   * One request in the line, tried again when Open Library says it is busy (a 5xx) or rate-limits us (a 429).
   * Each try takes its turn in the line.
   */
  function request<T>(url: string): Promise<T> {
    return withRetries(() => (limiter ? limiter.run(() => getJson<T>(url, options)) : getJson<T>(url, options)), sleep)
  }

  /** One `limit=0` request — Open Library's own `numFound`, no document bodies fetched. */
  async function countWorks(authorKey: string, query: string): Promise<number> {
    const response = await request<WorkSearchResponse>(
      `${BASE}/search.json?author_key=${encodeURIComponent(authorKey)}` +
        `&q=${encodeURIComponent(query)}&limit=0`,
    )

    return response.numFound ?? 0
  }

  /** The exact count of an author's works tagged with `language` — mirrors `classifyLanguage`'s strict branch. */
  function countWorksInLanguage(authorKey: string, language: string): Promise<number> {
    return countWorks(authorKey, `language:${language}`)
  }

  /**
   * The exact count of an author's works carrying no language tag at all —
   * confirmed live that Open Library's query syntax supports this directly
   * (`-language:*`, a real Solr existence-negation, not a guess), so
   * `classifyLanguage`'s "include unknown" widening gets a real number too,
   * not just the strict language count.
   */
  function countUntaggedWorks(authorKey: string): Promise<number> {
    return countWorks(authorKey, '-language:*')
  }

  return {
    // Needs no credentials.
    isAvailable: () => true,

    /**
     * The "N works" detail is an author's total across every language by
     * default. Once the GUI's language picker chooses a specific one, that
     * total stops being the number this search will actually build — real,
     * verified-live case: Lucinda Riley shows "133 works" but a strict
     * Russian filter builds a 1-item list. Rather than show a number known
     * to be wrong, this fetches the real filtered count instead — one cheap
     * request per candidate author (two with "include unknown" also
     * checked, added together), run in parallel.
     */
    async search(query, searchOptions) {
      const response = await request<AuthorSearchResponse>(
        `${BASE}/search/authors.json?q=${encodeURIComponent(query)}`,
      )

      // Collapsed before the top-8 cut, not after — otherwise a duplicate
      // record could push a genuinely different author out of the results.
      const authors = collapseAuthorDuplicates(response.docs ?? []).slice(0, 8)

      const language = searchOptions?.language
      const isFiltering = Boolean(language && language !== 'all')
      const includeUnknown = Boolean(searchOptions?.includeUnknown)

      const counts = isFiltering
        ? await Promise.all(
            authors.map(async (author) => {
              const tagged = await countWorksInLanguage(author.key, language!)
              const untagged = includeUnknown ? await countUntaggedWorks(author.key) : 0
              return tagged + untagged
            }),
          )
        : undefined

      return authors.map((author, index): ListSource => {
        // No filter: the original unfiltered total. Otherwise: this
        // author's own accurate, filter-matching count, including a real
        // zero, which is still meaningful signal.
        const workCount = !isFiltering ? author.work_count : counts?.[index]

        const detail = [workCount !== undefined ? `${workCount} works` : undefined, author.top_work]
          .filter(Boolean)
          .join(' · ')

        return {
          externalRef: `author:${author.key}`,
          title: `${author.name} — bibliography`,
          ...(detail ? { detail } : {}),
        }
      })
    },

    // No upstream signal for whether this is finished, so no `status` (BL-013).
    expand: itemsOnly(async (externalRef) => {
      // A third `:<language>` segment, and a fourth literal `:unknown` flag
      // (task: book-language filtering), are appended by the
      // /lists/from-source route only when the GUI's book-only language
      // picker sent them — every other adapter's refs stay two segments and
      // these are ignored there too, since destructuring a shorter split
      // just leaves them undefined.
      const [kind, key, language, unknownFlag] = externalRef.split(':')
      if (kind !== 'author' || !key) return []
      const includeUnknown = unknownFlag === UNKNOWN

      const works: NonNullable<WorkSearchResponse['docs']> = []

      for (let offset = 0; ; offset += PAGE_SIZE) {
        const response = await request<WorkSearchResponse>(
          `${BASE}/search.json?author_key=${encodeURIComponent(key)}` +
            `&fields=title,number_of_pages_median,first_publish_year,language&sort=old` +
            `&limit=${PAGE_SIZE}&offset=${offset}`,
        )

        // Said before reading on: an author this large is refused after one request, not twenty.
        const total = response.numFound
        if (total !== undefined && total > MAX_WORKS_READ) throw new ListTooLargeError(total)

        const batch = response.docs ?? []
        works.push(...batch)
        if (works.length > MAX_WORKS_READ) throw new ListTooLargeError(works.length)

        if (batch.length < PAGE_SIZE || (total !== undefined && works.length >= total)) break
      }

      const candidates = works
        .filter((work) => work.title)
        .flatMap((work): MediaTypeCandidate[] => {
          const languageOutcome = classifyLanguage(work.language, language, includeUnknown)
          if (languageOutcome === null) return []

          const pages = work.number_of_pages_median

          return [
            {
              title: work.title!,
              // Books with no recorded page count fall back to the category
              // default rather than being dropped — an unmeasured book is
              // still part of the bibliography.
              ...(pages ? { timeToConsumeMinutes: Math.round(pages * MINUTES_PER_PAGE) } : {}),
              ...(work.first_publish_year ? { year: work.first_publish_year } : {}),
              ...(languageOutcome ? { tags: [languageTagLabel(languageOutcome)] } : {}),
            },
          ]
        })

      // Every work read is listed, a duplicate title collapsed to one: the list is cut by nothing here, and a list
      // above the ceiling is refused by whoever asked (`checkListSize`), never trimmed.
      return dedupeByTitle(candidates)
    }),
  }
}
