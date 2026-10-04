import { describe, expect, it, vi } from 'vitest'
import { MAX_LIST_ITEMS } from '../catalog/limits.js'
import { checkListSize, countSource, expandSource, ListTooLargeError } from './expandSource.js'
import type { MediaTypeCandidate, SearchAdapter } from './mediaTypes.js'
import { refForAdapter } from './sourceRef.js'

const items = (count: number): MediaTypeCandidate[] => Array.from({ length: count }, (_, index) => ({ title: `Item ${index + 1}` }))

describe('the ceiling on a list (15.9)', () => {
  it('is ten thousand items', () => {
    expect(MAX_LIST_ITEMS).toBe(10_000)
  })

  it('lets a source of exactly the ceiling through, and fails loudly one item above it, naming the count', () => {
    expect(() => checkListSize(MAX_LIST_ITEMS)).not.toThrow()

    const error = (() => {
      try {
        checkListSize(MAX_LIST_ITEMS + 1)
      } catch (caught) {
        return caught
      }
    })()
    expect(error).toBeInstanceOf(ListTooLargeError)
    expect(error).toMatchObject({ count: 10_001, max: 10_000 })
  })

  it('fails the count and the Preview of a source above it, rather than answering with a number nobody can add', async () => {
    const adapter: SearchAdapter = { isAvailable: () => true, search: async () => [], expand: vi.fn(async () => ({ items: items(10_001) })) }

    await expect(expandSource({ key: 'movie', label: 'Movies', adapter }, 'company:1', {}, new Set(['movie']))).rejects.toBeInstanceOf(ListTooLargeError)
  })

  it('passes a source at the ceiling', async () => {
    const adapter: SearchAdapter = { isAvailable: () => true, search: async () => [], expand: vi.fn(async () => ({ items: items(10_000) })) }

    const expansion = await expandSource({ key: 'movie', label: 'Movies', adapter }, 'company:1', {}, new Set(['movie']))

    expect(expansion.items).toHaveLength(10_000)
  })
})

describe('a count that costs less than a listing (YouTube audit)', () => {
  const movie = (adapter: SearchAdapter) => ({ key: 'movie', label: 'Movies', adapter })
  const base = { isAvailable: () => true, search: async () => [], expand: vi.fn(async () => ({ items: items(3) })) }

  it('asks the adapter for the number and never lists the source', async () => {
    const count = vi.fn(async () => 6184)
    const expand = vi.fn(base.expand)

    const counted = await countSource(movie({ ...base, expand, count }), 'channel:UC1', {})

    expect(counted).toBe(6184)
    expect(count).toHaveBeenCalledExactlyOnceWith('channel:UC1')
    expect(expand).not.toHaveBeenCalled()
  })

  it('asks with the ref an import would use, so the count is the count Add list makes', async () => {
    const count = vi.fn(async () => 1)
    const options = { includeEp: true, includeSingle: false }

    await countSource(movie({ ...base, count }), 'artist-1', options)

    expect(refForAdapter('artist-1', options)).not.toBe('artist-1')
    expect(count).toHaveBeenCalledExactlyOnceWith(refForAdapter('artist-1', options))
  })

  it('has no answer when the adapter has no cheap count, or declines to give one', async () => {
    expect(await countSource(movie(base), 'x', {})).toBeUndefined()
    expect(await countSource(movie({ ...base, count: async () => undefined }), 'x', {})).toBeUndefined()
  })

  it('has no answer for a curated list, or a category with no usable adapter, so the listing path decides', async () => {
    const count = vi.fn(async () => 5)

    expect(await countSource(movie({ ...base, count }), 'canonical:lists/movie/x.yaml', {})).toBeUndefined()
    expect(await countSource(movie({ ...base, count, isAvailable: () => false }), 'x', {})).toBeUndefined()
    expect(await countSource({ key: 'movie', label: 'Movies' }, 'x', {})).toBeUndefined()
    expect(count).not.toHaveBeenCalled()
  })

  it('refuses a source above the ceiling by its count, as the listing would', async () => {
    const error = await countSource(movie({ ...base, count: async () => MAX_LIST_ITEMS + 1 }), 'x', {}).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ListTooLargeError)
    expect(error).toMatchObject({ count: MAX_LIST_ITEMS + 1 })
    expect(await countSource(movie({ ...base, count: async () => MAX_LIST_ITEMS }), 'x', {})).toBe(MAX_LIST_ITEMS)
  })
})
