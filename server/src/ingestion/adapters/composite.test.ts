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
    expand: async (ref) => ({ items: [{ title: `expanded ${ref}` }] }),
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

  describe('tagging what a source brings', () => {
    const tagged = (tag: string | undefined, items: { title: string; tags?: string[] }[]) =>
      createCompositeAdapter([
        {
          prefixes: ['show'],
          ...(tag ? { tag } : {}),
          adapter: {
            isAvailable: () => true,
            search: async () => [],
            expand: async () => ({ items, status: 'ongoing' as const }),
          },
        },
      ])

    it('gives every item of a tagged source that tag, and leaves the status alone', async () => {
      // A Ghost in the Shell film and its series share an Animation list: the source is what tells them apart.
      const result = await tagged('tv', [{ title: 'Stand Alone Complex' }]).expand('show:1')

      expect(result.items).toEqual([{ title: 'Stand Alone Complex', tags: ['tv'] }])
      expect(result.status).toBe('ongoing')
    })

    it('adds to tags an item already has, without repeating one', async () => {
      const result = await tagged('tv', [
        { title: 'A', tags: ['Anime'] },
        { title: 'B', tags: ['TV'] },
      ]).expand('show:1')

      expect(result.items.map((item) => item.tags)).toEqual([['Anime', 'tv'], ['TV']])
    })

    it('changes nothing for a source without a tag', async () => {
      const result = await tagged(undefined, [{ title: 'A' }]).expand('show:1')

      expect(result.items).toEqual([{ title: 'A' }])
    })
  })

  it('returns nothing for a ref no source claims', async () => {
    const adapter = createCompositeAdapter([{ prefixes: ['show'], adapter: source('show', []) }])

    expect((await adapter.expand('franchise:1')).items).toEqual([])
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
      expand: async () => ({ items: [] }),
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
      expand: async () => ({ items: [] }),
    }

    const adapter = createCompositeAdapter([
      { prefixes: ['a'], adapter: failing },
      { prefixes: ['b'], adapter: source('b', []) },
    ])

    await expect(adapter.search('x')).rejects.toThrow(/upstream is down/)
  })

  it("passes the owning source's production status through with its items", async () => {
    const shows: SearchAdapter = {
      ...source('show', []),
      expand: async () => ({ items: [{ title: 'Episode 1' }], status: 'complete' }),
    }

    const adapter = createCompositeAdapter([{ prefixes: ['show'], adapter: shows }])

    expect(await adapter.expand('show:1')).toEqual({
      items: [{ title: 'Episode 1' }],
      status: 'complete',
    })
  })
})
