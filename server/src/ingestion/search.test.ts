import { describe, expect, it, vi } from 'vitest'
import type { MediaType, SearchAdapter } from './mediaTypes.js'
import { searchSources, SearchUnavailableError } from './search.js'

const curated = { externalRef: 'canonical:lists/mega/x.yaml', title: 'Curated X', detail: 'Canonical list' }

function adapter(available = true): SearchAdapter {
  return {
    isAvailable: () => available,
    search: vi.fn(async () => [{ externalRef: 'franchise:1', title: 'tmdb x' }]),
    expand: vi.fn(async () => ({ items: [] })),
  }
}

function type(overrides: Partial<MediaType> = {}): MediaType {
  return { key: 'mega', label: 'Mega', sortOrder: 1, defaultDurationMinutes: 60, ...overrides }
}

const library = (matches: (typeof curated)[], reachable = true) => vi.fn(async () => ({ matches, reachable }))

describe('searchSources', () => {
  it('puts library matches ahead of the adapter’s own results', async () => {
    const result = await searchSources(type({ adapter: adapter() }), 'x', {}, library([curated]))

    expect(result.sources.map((source) => source.externalRef)).toEqual(['canonical:lists/mega/x.yaml', 'franchise:1'])
  })

  it('a library-only category never asks its adapter: only curated lists are offered (Mega, F9)', async () => {
    const own = adapter()
    const result = await searchSources(type({ adapter: own, searchScope: 'library' }), 'x', {}, library([curated]))

    expect(result.sources).toEqual([curated])
    expect(own.search).not.toHaveBeenCalled()
  })

  it('a library-only category with no match finds nothing — not "search needs a key"', async () => {
    const result = await searchSources(type({ searchScope: 'library' }), 'witcher', {}, library([]))

    expect(result).toEqual({ sources: [] })
  })

  it('a library-only category says it is offline when the library cannot be reached', async () => {
    await expect(searchSources(type({ searchScope: 'library' }), 'x', {}, library([], false))).rejects.toEqual(
      new SearchUnavailableError('search.unavailableOffline'),
    )
  })

  it('a category without a working adapter still offers library matches, and otherwise says search is unavailable', async () => {
    expect((await searchSources(type({ adapter: adapter(false) }), 'x', {}, library([curated]))).sources).toEqual([curated])
    await expect(searchSources(type(), 'x', {}, library([]))).rejects.toEqual(new SearchUnavailableError('search.unavailable'))
  })

  it('flags an unreachable library beside the adapter’s results', async () => {
    const result = await searchSources(type({ adapter: adapter() }), 'x', {}, library([], false))

    expect(result).toEqual({ sources: [{ externalRef: 'franchise:1', title: 'tmdb x' }], libraryUnreachable: true })
  })
})

describe('searchSources, a page at a time (Comic Vine "Show more")', () => {
  /** An adapter that pages: `pages` is what `searchPage` answers for page 1, 2, ... */
  function paging(pages: { sources: { externalRef: string; title: string }[]; hasMore?: true; total?: number; totalIsLowerBound?: true }[]): SearchAdapter {
    return {
      isAvailable: () => true,
      search: vi.fn(async () => []),
      expand: vi.fn(async () => ({ items: [] })),
      searchPage: vi.fn(async (_query, options) => pages[(options?.page ?? 1) - 1] ?? { sources: [] }),
    }
  }

  const row = (id: number) => ({ externalRef: `volume:${id}`, title: `Volume ${id}` })

  it('says there is more, and how many there are, when the adapter does, counting the curated matches too', async () => {
    const own = paging([{ sources: [row(1), row(2)], hasMore: true, total: 52, totalIsLowerBound: true }])
    const result = await searchSources(type({ adapter: own }), 'x', {}, library([curated]))

    expect(result).toEqual({
      sources: [curated, row(1), row(2)],
      hasMore: true,
      total: 53,
      totalIsLowerBound: true,
    })
  })

  it('leaves out hasMore and the lower-bound flag when the adapter has none, and keeps an exact total', async () => {
    const result = await searchSources(type({ adapter: paging([{ sources: [row(1)], total: 1 }]) }), 'x', {}, library([]))

    expect(result).toEqual({ sources: [row(1)], total: 1 })
  })

  it('asks the adapter for the page wanted, and for page one when none is named', async () => {
    const own = paging([{ sources: [row(1)] }, { sources: [row(2)] }])

    await searchSources(type({ adapter: own }), 'x', {}, library([]))
    await searchSources(type({ adapter: own }), 'x', { page: 2 }, library([]))

    expect(vi.mocked(own.searchPage!).mock.calls.map(([, options]) => options?.page ?? 1)).toEqual([1, 2])
  })

  it('a later page is the adapter’s rows alone: the library is not asked again, and nothing about it is reported', async () => {
    const own = paging([{ sources: [row(1)] }, { sources: [row(2)], hasMore: true, total: 40, totalIsLowerBound: true }])
    const lookup = library([curated], false)

    const result = await searchSources(type({ adapter: own }), 'x', { page: 2 }, lookup)

    expect(lookup).not.toHaveBeenCalled()
    expect(result).toEqual({ sources: [row(2)], hasMore: true, total: 40, totalIsLowerBound: true })
  })

  it('an adapter that does not page has nothing on a later page, and says nothing is more on the first', async () => {
    const own = adapter()

    expect(await searchSources(type({ adapter: own }), 'x', { page: 2 }, library([curated]))).toEqual({ sources: [] })
    expect(own.search).not.toHaveBeenCalled()
    expect(await searchSources(type({ adapter: own }), 'x', {}, library([]))).toEqual({ sources: [{ externalRef: 'franchise:1', title: 'tmdb x' }] })
  })

  it('a later page of an adapter that cannot run now is empty, though it pages', async () => {
    const own = { ...paging([{ sources: [row(1)] }, { sources: [row(2)] }]), isAvailable: () => false }

    expect(await searchSources(type({ adapter: own }), 'x', { page: 2 }, library([]))).toEqual({ sources: [] })
    expect(own.searchPage).not.toHaveBeenCalled()
  })

  it('still flags an unreachable library beside a paging adapter’s first page', async () => {
    const own = paging([{ sources: [row(1)], total: 1 }])

    expect(await searchSources(type({ adapter: own }), 'x', {}, library([], false))).toEqual({
      sources: [row(1)],
      libraryUnreachable: true,
      total: 1,
    })
  })

  it('a later page of a library-only category, or of a category with no usable adapter, is empty and not an error', async () => {
    const lookup = library([curated])

    expect(await searchSources(type({ searchScope: 'library' }), 'x', { page: 2 }, lookup)).toEqual({ sources: [] })
    expect(await searchSources(type({ adapter: adapter(false) }), 'x', { page: 2 }, lookup)).toEqual({ sources: [] })
    expect(await searchSources(type(), 'x', { page: 2 }, lookup)).toEqual({ sources: [] })
    expect(lookup).not.toHaveBeenCalled()
  })
})

