import { dedupeByTitle } from '../dedupe.js'
import { getJson, type FetchLike } from '../http.js'
import type { ListSource, MediaTypeCandidate, SearchAdapter } from '../mediaTypes.js'

/**
 * Open Library: search an author, expand to their bibliography.
 *
 * No API key, and page counts come back with the search results rather than
 * costing a request each — so a bibliography arrives with real reading
 * estimates in one or two round trips.
 */

const BASE = 'https://openlibrary.org'
const PAGE_SIZE = 100
/** Prolific authors are genuinely prolific: Terry Pratchett has 235 works. */
const MAX_ITEMS = 300
const MAX_PAGES = 3

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
  }[]
}

export function createOpenLibraryAdapter(fetchImpl?: FetchLike): SearchAdapter {
  const options = { source: 'Open Library', ...(fetchImpl ? { fetchImpl } : {}) }

  return {
    // Needs no credentials.
    isAvailable: () => true,

    async search(query) {
      const response = await getJson<AuthorSearchResponse>(
        `${BASE}/search/authors.json?q=${encodeURIComponent(query)}`,
        options,
      )

      // Collapsed before the top-8 cut, not after — otherwise a duplicate
      // record could push a genuinely different author out of the results.
      const authors = collapseAuthorDuplicates(response.docs ?? [])

      return authors.slice(0, 8).map((author): ListSource => {
        const detail = [
          author.work_count ? `${author.work_count} works` : undefined,
          author.top_work,
        ]
          .filter(Boolean)
          .join(' · ')

        return {
          externalRef: `author:${author.key}`,
          title: `${author.name} — bibliography`,
          ...(detail ? { detail } : {}),
        }
      })
    },

    async expand(externalRef) {
      const [kind, key] = externalRef.split(':')
      if (kind !== 'author' || !key) return []

      const works: NonNullable<WorkSearchResponse['docs']> = []

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await getJson<WorkSearchResponse>(
          `${BASE}/search.json?author_key=${encodeURIComponent(key)}` +
            `&fields=title,number_of_pages_median,first_publish_year&sort=old` +
            `&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
          options,
        )

        const batch = response.docs ?? []
        works.push(...batch)

        if (batch.length < PAGE_SIZE || works.length >= MAX_ITEMS) break
      }

      const candidates = works
        .filter((work) => work.title)
        .map((work): MediaTypeCandidate => {
          const pages = work.number_of_pages_median

          return {
            title: work.title!,
            // Books with no recorded page count fall back to the category
            // default rather than being dropped — an unmeasured book is still
            // part of the bibliography.
            ...(pages ? { timeToConsumeMinutes: Math.round(pages * MINUTES_PER_PAGE) } : {}),
            ...(work.first_publish_year ? { year: work.first_publish_year } : {}),
          }
        })

      // Deduped before the size cap, not after — the same reasoning as
      // search()'s author collapse above: cutting first could count a
      // duplicate against the limit instead of a real, distinct title.
      return dedupeByTitle(candidates).slice(0, MAX_ITEMS)
    },
  }
}
