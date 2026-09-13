import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../http.js'
import { createOpenLibraryAdapter } from './openLibrary.js'

/**
 * Fixtures are trimmed from real Open Library responses (verified live against
 * Terry Pratchett, OL25712A).
 */

function respondWith(body: unknown, status = 200): FetchLike {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

/** Routes each request by a substring of its URL, for a search that fans out into several fetches. */
function routedFetch(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (url: string) => {
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) throw new Error(`unexpected fetch: ${url}`)
    return new Response(JSON.stringify(match[1]))
  })
}

const AUTHORS = {
  docs: [
    { key: 'OL25712A', name: 'Terry Pratchett', work_count: 236, top_work: 'The Colour of Magic' },
    { key: 'OL9999A', name: 'Terry Pratchett Jr' },
  ],
}

const WORKS = {
  numFound: 4,
  docs: [
    { title: 'The Carpet People', number_of_pages_median: 208, first_publish_year: 1971 },
    { title: 'The Colour of Magic', number_of_pages_median: 240, first_publish_year: 1983 },
    // Omnibus editions really do come back with no page count.
    { title: 'The Colour of Magic, The Light Fantastic', first_publish_year: 1987 },
    { title: 'Mort', number_of_pages_median: 297, first_publish_year: 1987 },
  ],
}

describe('Open Library adapter', () => {
  it('needs no credentials', () => {
    expect(createOpenLibraryAdapter().isAvailable()).toBe(true)
  })

  it('finds authors, with their size and best-known work to tell them apart', async () => {
    const adapter = createOpenLibraryAdapter(respondWith(AUTHORS))

    expect(await adapter.search('terry pratchett')).toEqual([
      {
        externalRef: 'author:OL25712A',
        title: 'Terry Pratchett — bibliography',
        detail: '236 works · The Colour of Magic',
      },
      { externalRef: 'author:OL9999A', title: 'Terry Pratchett Jr — bibliography' },
    ])
  })

  it('collapses duplicate author records to the one with the most works (task 6.10)', async () => {
    // Mirrors a real, verified-live case: Open Library's author search
    // returns several exact-name-matching database records for one real
    // person, not several real people.
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { key: 'OL1A', name: 'Stephen King', work_count: 5 },
          { key: 'OL2A', name: 'Stephen King', work_count: 611 },
          { key: 'OL3A', name: 'Stephen King', work_count: 12 },
          { key: 'OL4A', name: 'Neil Gaiman', work_count: 90 },
        ],
      }),
    )

    const results = await adapter.search('stephen king')

    expect(results).toEqual([
      { externalRef: 'author:OL2A', title: 'Stephen King — bibliography', detail: '611 works' },
      { externalRef: 'author:OL4A', title: 'Neil Gaiman — bibliography', detail: '90 works' },
    ])
  })

  it('collapses duplicates before the top-8 cut, not after', async () => {
    // Six duplicate records for one name plus five genuinely distinct
    // authors is 11 raw docs — collapsing first must not let the
    // duplicates crowd out real authors from the top 8.
    const duplicates = Array.from({ length: 6 }, (_, i) => ({
      key: `OL-dup-${i}`,
      name: 'Stephen King',
      work_count: i,
    }))
    const distinct = Array.from({ length: 5 }, (_, i) => ({
      key: `OL-real-${i}`,
      name: `Author ${i}`,
      work_count: 10,
    }))

    const adapter = createOpenLibraryAdapter(respondWith({ docs: [...duplicates, ...distinct] }))
    const results = await adapter.search('king')

    expect(results).toHaveLength(6)
    expect(results.map((entry) => entry.title)).toContain('Author 4 — bibliography')
  })

  it('collapses case-different or padded duplicate names too', async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { key: 'OL1A', name: ' stephen king ', work_count: 3 },
          { key: 'OL2A', name: 'Stephen King', work_count: 611 },
        ],
      }),
    )

    expect(await adapter.search('king')).toEqual([
      { externalRef: 'author:OL2A', title: 'Stephen King — bibliography', detail: '611 works' },
    ])
  })

  it("shows an author's real, language-filtered count instead of the misleading unfiltered total", async () => {
    // Real, verified-live case: Lucinda Riley's search result says "133
    // works" (every language combined), but a strict Russian filter builds
    // a 1-item list — showing "133" here would be actively wrong.
    const fetchImpl = routedFetch({
      'search/authors.json': {
        docs: [{ key: 'OL1A', name: 'Lucinda Riley', work_count: 133 }],
      },
      'author_key=OL1A&q=language%3Arus&limit=0': { numFound: 1, docs: [] },
    })

    const results = await createOpenLibraryAdapter(fetchImpl).search('riley', { language: 'rus' })

    expect(results).toEqual([
      { externalRef: 'author:OL1A', title: 'Lucinda Riley — bibliography', detail: '1 works' },
    ])
  })

  it('shows a real zero rather than falling back to the unfiltered total', async () => {
    const fetchImpl = routedFetch({
      'search/authors.json': { docs: [{ key: 'OL1A', name: 'Some Author', work_count: 40 }] },
      'author_key=OL1A&q=language%3Akor&limit=0': { numFound: 0, docs: [] },
    })

    const results = await createOpenLibraryAdapter(fetchImpl).search('some', { language: 'kor' })

    expect(results).toEqual([
      { externalRef: 'author:OL1A', title: 'Some Author — bibliography', detail: '0 works' },
    ])
  })

  it('counts each candidate author independently, in parallel', async () => {
    const fetchImpl = routedFetch({
      'search/authors.json': {
        docs: [
          { key: 'OL1A', name: 'Author One', work_count: 10 },
          { key: 'OL2A', name: 'Author Two', work_count: 20 },
        ],
      },
      'author_key=OL1A&q=language%3Afre&limit=0': { numFound: 3, docs: [] },
      'author_key=OL2A&q=language%3Afre&limit=0': { numFound: 7, docs: [] },
    })

    const results = await createOpenLibraryAdapter(fetchImpl).search('author', { language: 'fre' })

    expect(results.map((r) => r.detail)).toEqual(['3 works', '7 works'])
  })

  it('keeps the unfiltered total when the language is "all"', async () => {
    const fetchImpl = respondWith({
      docs: [{ key: 'OL1A', name: 'Lucinda Riley', work_count: 133 }],
    })

    const results = await createOpenLibraryAdapter(fetchImpl).search('riley', { language: 'all' })

    expect(results).toEqual([
      { externalRef: 'author:OL1A', title: 'Lucinda Riley — bibliography', detail: '133 works' },
    ])
  })

  it('adds the untagged count to the language count for "include unknown", confirmed against Open Library\'s own negation query', async () => {
    // Confirmed live: Open Library's search syntax supports `-language:*`
    // as a real existence-negation query, not a guess — Lucinda Riley
    // returns exactly 76 this way, matching the real 76 untagged works
    // found by inspecting her full bibliography by hand.
    const fetchImpl = routedFetch({
      'search/authors.json': {
        docs: [
          { key: 'OL1A', name: 'Lucinda Riley', work_count: 133, top_work: 'The Seven Sisters' },
        ],
      },
      'author_key=OL1A&q=language%3Arus&limit=0': { numFound: 1, docs: [] },
      'author_key=OL1A&q=-language%3A*&limit=0': { numFound: 76, docs: [] },
    })

    const results = await createOpenLibraryAdapter(fetchImpl).search('riley', {
      language: 'rus',
      includeUnknown: true,
    })

    expect(results).toEqual([
      {
        externalRef: 'author:OL1A',
        title: 'Lucinda Riley — bibliography',
        detail: '77 works · The Seven Sisters',
      },
    ])
    // Author search, plus one count request per query — still cheap
    // (`limit=0`, no document bodies), never the full paginated fetch.
    expect(vi.mocked(fetchImpl).mock.calls).toHaveLength(3)
  })

  it('turns page counts into reading time', async () => {
    const adapter = createOpenLibraryAdapter(respondWith(WORKS))

    expect(await adapter.expand('author:OL25712A')).toEqual([
      { title: 'The Carpet People', timeToConsumeMinutes: 250, year: 1971 },
      { title: 'The Colour of Magic', timeToConsumeMinutes: 288, year: 1983 },
      { title: 'The Colour of Magic, The Light Fantastic', year: 1987 },
      { title: 'Mort', timeToConsumeMinutes: 356, year: 1987 },
    ])
  })

  it('dedupes two editions of the same title to the earliest year (task 6.10)', async () => {
    // Mirrors a real, verified-live case: Brandon Sanderson's bibliography
    // lists "Elantris" twice — a 2005 edition and a 2025 edition.
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'Elantris', number_of_pages_median: 638, first_publish_year: 2005 },
          { title: 'Mistborn', number_of_pages_median: 541, first_publish_year: 2006 },
          { title: 'Elantris', number_of_pages_median: 592, first_publish_year: 2025 },
        ],
      }),
    )

    expect(await adapter.expand('author:OL1A')).toEqual([
      { title: 'Elantris', timeToConsumeMinutes: Math.round(638 * 1.2), year: 2005 },
      { title: 'Mistborn', timeToConsumeMinutes: Math.round(541 * 1.2), year: 2006 },
    ])
  })

  it("dedupes titles case-insensitively, using the winning edition's own casing", async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'the shining', first_publish_year: 2010 },
          { title: 'Carrie', first_publish_year: 1974 },
          { title: 'The Shining', first_publish_year: 1977 },
        ],
      }),
    )

    // Stays in "the shining"'s first-seen list position, but the earlier
    // (1977) edition's own title casing wins along with the rest of its
    // data — the two never get merged into a composite of both.
    expect((await adapter.expand('author:OL1A')).map((item) => [item.title, item.year])).toEqual([
      ['The Shining', 1977],
      ['Carrie', 1974],
    ])
  })

  it('keeps a book whose page count is unknown, rather than dropping it', async () => {
    // It falls back to the category default downstream. An unmeasured book is
    // still part of the bibliography.
    const adapter = createOpenLibraryAdapter(respondWith(WORKS))
    const items = await adapter.expand('author:OL25712A')

    const omnibus = items.find((item) => item.title.startsWith('The Colour of Magic, '))
    expect(omnibus).toBeDefined()
    expect(omnibus?.timeToConsumeMinutes).toBeUndefined()
  })

  it('leaves year unset for a work with no recorded publish year', async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({ docs: [{ title: 'Undated Work', number_of_pages_median: 100 }] }),
    )

    expect(await adapter.expand('author:OL25712A')).toEqual([
      { title: 'Undated Work', timeToConsumeMinutes: 120 },
    ])
  })

  it('asks for works in publication order, and only the fields it uses', async () => {
    const fetchImpl = respondWith(WORKS)
    await createOpenLibraryAdapter(fetchImpl).expand('author:OL25712A')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain('sort=old')
    expect(url).toContain('author_key=OL25712A')
    // Page counts arrive with the search results; asking per book would cost
    // one request each.
    expect(url).toContain('number_of_pages_median')
  })

  it('returns nothing for a ref it does not understand', async () => {
    const adapter = createOpenLibraryAdapter(respondWith(WORKS))

    expect(await adapter.expand('series:discworld')).toEqual([])
    expect(await adapter.expand('nonsense')).toEqual([])
  })

  it('survives responses missing their fields', async () => {
    const adapter = createOpenLibraryAdapter(respondWith({}))

    expect(await adapter.search('x')).toEqual([])
    expect(await adapter.expand('author:OL1A')).toEqual([])
  })

  it('names the service when it fails', async () => {
    const adapter = createOpenLibraryAdapter(respondWith({}, 503))

    await expect(adapter.search('x')).rejects.toThrow(/Open Library returned 503/)
  })

  it('strictly keeps only works actually tagged with the requested language, by default', async () => {
    // Mirrors a real, verified-live case: Murakami's "Norwegian Wood" shows
    // up as several separate Open Library work records — some tagged
    // Japanese only, some with no language tag at all, some English.
    // Strict-by-default (task: real Lucinda Riley data showed 76/133 works
    // with no language tag at all — "always keep unknown" swamped the
    // filter for her).
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'Norwegian Wood', language: ['eng'], first_publish_year: 2000 },
          { title: 'ノルウェイの森', language: ['jpn'], first_publish_year: 1987 },
          { title: 'Norwegian Wood = Noruei no mori', first_publish_year: 2004 },
          { title: 'Tokio Blues', language: ['spa'], first_publish_year: 2015 },
        ],
      }),
    )

    const items = await adapter.expand('author:OL1A:eng')

    expect(items).toEqual([{ title: 'Norwegian Wood', year: 2000, language: 'eng' }])
  })

  it('widens to also keep works with no language tag when the "include unknown" flag is set', async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'Norwegian Wood', language: ['eng'], first_publish_year: 2000 },
          { title: 'ノルウェイの森', language: ['jpn'], first_publish_year: 1987 },
          { title: 'Norwegian Wood = Noruei no mori', first_publish_year: 2004 },
        ],
      }),
    )

    const items = await adapter.expand('author:OL1A:eng:unknown')

    expect(items).toEqual([
      { title: 'Norwegian Wood', year: 2000, language: 'eng' },
      { title: 'Norwegian Wood = Noruei no mori', year: 2004, language: 'unknown' },
    ])
  })

  it('cannot catch a work Open Library itself mistagged — a known, accepted limitation', async () => {
    // Mirrors a real, verified-live case: one of the same "Norwegian Wood"
    // records is tagged `language: ['eng']` by Open Library despite its own
    // title field being the Japanese one. Nothing in this adapter can tell
    // that apart from a genuinely correct English-tagged, English-titled
    // record — the filter can only trust the tag it's given. Pinned here so
    // this is a documented, accepted gap, not a future "regression."
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [{ title: 'ノルウェイの森 [1/2]', language: ['eng'], first_publish_year: 1990 }],
      }),
    )

    expect((await adapter.expand('author:OL1A:eng')).map((item) => item.title)).toEqual([
      'ノルウェイの森 [1/2]',
    ])
  })

  it('records no language at all on any candidate when no filter is given, unchanged from before this feature', async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'Norwegian Wood', language: ['eng'] },
          { title: 'ノルウェイの森', language: ['jpn'] },
        ],
      }),
    )

    const items = await adapter.expand('author:OL1A')

    expect(items.map((item) => item.title)).toEqual(['Norwegian Wood', 'ノルウェイの森'])
    expect(items.every((item) => item.language === undefined)).toBe(true)
  })

  it('keeps everything, with no language recorded, when the language is explicitly "all"', async () => {
    const adapter = createOpenLibraryAdapter(
      respondWith({
        docs: [
          { title: 'Norwegian Wood', language: ['eng'] },
          { title: 'ノルウェイの森', language: ['jpn'] },
        ],
      }),
    )

    const items = await adapter.expand('author:OL1A:all')

    expect(items.map((item) => item.title)).toEqual(['Norwegian Wood', 'ノルウェイの森'])
    expect(items.every((item) => item.language === undefined)).toBe(true)
  })

  it('always asks Open Library for the language field, filtered or not', async () => {
    const fetchImpl = respondWith(WORKS)
    await createOpenLibraryAdapter(fetchImpl).expand('author:OL25712A')

    const [url] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toContain('language')
  })

  it('stops after a bounded number of pages', async () => {
    // A full page every time would otherwise loop forever on a big author.
    // Titles are unique across pages (not just within one) so this exercises
    // the pagination bound on its own, not task 6.10's title dedup.
    let page = 0
    const fetchImpl: FetchLike = vi.fn(async () => {
      const offset = page * 100
      page += 1

      return new Response(
        JSON.stringify({
          docs: Array.from({ length: 100 }, (_, index) => ({
            title: `Book ${offset + index}`,
            number_of_pages_median: 200,
          })),
        }),
      )
    })

    const items = await createOpenLibraryAdapter(fetchImpl).expand('author:OL1A')

    expect(items).toHaveLength(300)
    expect(vi.mocked(fetchImpl).mock.calls.length).toBeLessThanOrEqual(3)
  })
})
