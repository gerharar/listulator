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
