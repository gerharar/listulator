import { describe, expect, it, vi } from 'vitest'
import type { SearchAdapter } from '../mediaTypes.js'
import { createCompositeAdapter } from './composite.js'

function source(
  prefix: string,
  titles: string[],
  { available = true }: { available?: boolean } = {},
): SearchAdapter {
  return {
    isAvailable: () => available,
    search: async () => titles.map((title) => ({ externalRef: `${prefix}:1`, title })),
    expand: async (ref) => [{ title: `expanded ${ref}` }],
  }
}

describe('composite sources', () => {
  it('merges results from every source', async () => {
    // Animation is the case this exists for: a series and a studio are both
    // unarguably animation, and neither shape covers the other.
    const adapter = createCompositeAdapter([
      { prefixes: ['show'], adapter: source('show', ['Naruto']) },
      { prefixes: ['company'], adapter: source('company', ['Studio Ghibli — films']) },
    ])

    expect((await adapter.search('anything')).map((result) => result.title)).toEqual([
      'Naruto',
      'Studio Ghibli — films',
    ])
  })

  it('sends an expansion to the source that owns the ref', async () => {
    const shows = source('show', [])
    const companies = source('company', [])
    const showSpy = vi.spyOn(shows, 'expand')
    const companySpy = vi.spyOn(companies, 'expand')

    const adapter = createCompositeAdapter([
      { prefixes: ['show'], adapter: shows },
      { prefixes: ['company'], adapter: companies },
    ])

    await adapter.expand('company:10342')

    // Routed by prefix rather than tried in turn, so no request is fired at a
    // service that was never going to answer.
    expect(companySpy).toHaveBeenCalledOnce()
    expect(showSpy).not.toHaveBeenCalled()
  })

  it('returns nothing for a ref no source claims', async () => {
    const adapter = createCompositeAdapter([{ prefixes: ['show'], adapter: source('show', []) }])

    expect(await adapter.expand('franchise:1')).toEqual([])
  })

  it('skips sources that are unavailable', async () => {
    // A missing TMDB key should not take out the sources that need none.
    const adapter = createCompositeAdapter([
      { prefixes: ['show'], adapter: source('show', ['Needs a key'], { available: false }) },
      { prefixes: ['page'], adapter: source('page', ['Needs nothing']) },
    ])

    expect(adapter.isAvailable()).toBe(true)
    expect((await adapter.search('x')).map((result) => result.title)).toEqual(['Needs nothing'])
  })

  it('is unavailable only when every source is', () => {
    const adapter = createCompositeAdapter([
      { prefixes: ['a'], adapter: source('a', [], { available: false }) },
      { prefixes: ['b'], adapter: source('b', [], { available: false }) },
    ])

    expect(adapter.isAvailable()).toBe(false)
  })

  it('still answers when one source fails', async () => {
    const failing: SearchAdapter = {
      isAvailable: () => true,
      search: async () => {
        throw new Error('upstream is down')
      },
      expand: async () => [],
    }

    const adapter = createCompositeAdapter([
      { prefixes: ['a'], adapter: failing },
      { prefixes: ['b'], adapter: source('b', ['Still here']) },
    ])

    // A partial answer beats an error the user cannot act on.
    expect((await adapter.search('x')).map((result) => result.title)).toEqual(['Still here'])
  })

  it('reports the failure when nothing came back at all', async () => {
    const failing: SearchAdapter = {
      isAvailable: () => true,
      search: async () => {
        throw new Error('upstream is down')
      },
      expand: async () => [],
    }

    const adapter = createCompositeAdapter([
      { prefixes: ['a'], adapter: failing },
      { prefixes: ['b'], adapter: source('b', []) },
    ])

    await expect(adapter.search('x')).rejects.toThrow(/upstream is down/)
  })
})
