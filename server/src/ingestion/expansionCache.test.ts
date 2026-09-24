import { describe, expect, it, vi } from 'vitest'
import { createExpansionCache } from './expansionCache.js'

const value = (title: string) => ({ items: [{ title }] })

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
  let time = 0
  const cache = createExpansionCache({ ...options, now: () => time })

  return { cache, advance: (ms: number) => (time += ms) }
}

describe('expansion cache', () => {
  it('loads once, then serves the same answer', async () => {
    const { cache } = setup()
    const load = vi.fn(async () => value('A'))

    expect(await cache.get('k', load)).toEqual(value('A'))
    expect(await cache.get('k', load)).toEqual(value('A'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('keeps different keys apart', async () => {
    const { cache } = setup()
    const load = vi.fn(async () => value('A'))

    await cache.get('one', load)
    await cache.get('two', load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares one load between callers that ask while it is running', async () => {
    // A count and a Preview for the same result arrive together.
    const { cache } = setup()
    let finish: (v: ReturnType<typeof value>) => void = () => {}
    const load = vi.fn(() => new Promise<ReturnType<typeof value>>((resolve) => (finish = resolve)))

    const first = cache.get('k', load)
    const second = cache.get('k', load)
    finish(value('A'))

    expect(await first).toEqual(await second)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('goes back to the source once the entry is older than the TTL', async () => {
    const { cache, advance } = setup({ ttlMs: 1000 })
    const load = vi.fn(async () => value('A'))

    await cache.get('k', load)
    advance(999)
    await cache.get('k', load)
    expect(load).toHaveBeenCalledTimes(1)

    advance(2)
    await cache.get('k', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not remember a failure: the next ask tries again', async () => {
    const { cache } = setup()
    const load = vi
      .fn<() => Promise<ReturnType<typeof value>>>()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce(value('A'))

    await expect(cache.get('k', load)).rejects.toThrow('rate limited')
    expect(await cache.get('k', load)).toEqual(value('A'))
  })

  it('lets everyone waiting on a failed load see the failure', async () => {
    const { cache } = setup()
    let fail: (cause: Error) => void = () => {}
    const load = vi.fn(() => new Promise<ReturnType<typeof value>>((_, reject) => (fail = reject)))

    const first = cache.get('k', load)
    const second = cache.get('k', load)
    fail(new Error('down'))

    await expect(first).rejects.toThrow('down')
    await expect(second).rejects.toThrow('down')
  })

  it('evicts on request, so the next ask is fresh', async () => {
    const { cache } = setup()
    const load = vi.fn(async () => value('A'))

    await cache.get('k', load)
    cache.evict('k')
    await cache.get('k', load)

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('holds a bounded number of entries, dropping the least recently used', async () => {
    const { cache } = setup({ maxEntries: 2 })
    const load = vi.fn(async () => value('A'))

    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('a', load) // a is now the more recent
    await cache.get('c', load) // drops b
    load.mockClear()

    await cache.get('a', load)
    await cache.get('c', load)
    expect(load).not.toHaveBeenCalled()
    await cache.get('b', load)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
