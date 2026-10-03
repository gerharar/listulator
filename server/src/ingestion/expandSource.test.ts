import { describe, expect, it, vi } from 'vitest'
import { MAX_LIST_ITEMS } from '../catalog/limits.js'
import { checkListSize, expandSource, ListTooLargeError } from './expandSource.js'
import type { MediaTypeCandidate, SearchAdapter } from './mediaTypes.js'

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
