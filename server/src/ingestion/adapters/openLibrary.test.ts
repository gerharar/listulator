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

  it('dedupes titles case-insensitively, using the winning edition\'s own casing', async () => {
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
