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

  it('turns page counts into reading time', async () => {
    const adapter = createOpenLibraryAdapter(respondWith(WORKS))

    expect(await adapter.expand('author:OL25712A')).toEqual([
      { title: 'The Carpet People', timeToConsumeMinutes: 250, year: 1971 },
      { title: 'The Colour of Magic', timeToConsumeMinutes: 288, year: 1983 },
      { title: 'The Colour of Magic, The Light Fantastic', year: 1987 },
      { title: 'Mort', timeToConsumeMinutes: 356, year: 1987 },
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
    const fetchImpl: FetchLike = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            docs: Array.from({ length: 100 }, (_, index) => ({
              title: `Book ${index}`,
              number_of_pages_median: 200,
            })),
          }),
        ),
    )

    const items = await createOpenLibraryAdapter(fetchImpl).expand('author:OL1A')

    expect(items).toHaveLength(300)
    expect(vi.mocked(fetchImpl).mock.calls.length).toBeLessThanOrEqual(3)
  })
})
