import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { expandWithRuntimes, itemsOnly } from './expansion.js'
import type { ExpandOptions, RuntimeLookup, SearchAdapter } from './mediaTypes.js'

describe('itemsOnly', () => {
  it('returns the items and no status key at all — never a guessed value', async () => {
    const expand = itemsOnly(async () => [{ title: 'A' }])

    const expansion = await expand('ref')

    expect(expansion).toEqual({ items: [{ title: 'A' }] })
    expect('status' in expansion).toBe(false)
  })

  it('passes the ref through untouched', async () => {
    const seen: string[] = []

    await itemsOnly(async (ref) => (seen.push(ref), []))('author:OL1A:eng')

    expect(seen).toEqual(['author:OL1A:eng'])
  })
})

describe('itemsOnly and expand options', () => {
  it('hands the options to the expander, so an adapter can skip its per-item lookups', async () => {
    const seen: (ExpandOptions | undefined)[] = []

    await itemsOnly(async (_ref, options) => (seen.push(options), []))('ref', { runtimes: 'skip' })

    expect(seen).toEqual([{ runtimes: 'skip' }])
  })
})

describe('expandWithRuntimes', () => {
  /** A fake whose `skip` expansion leaves two films without a length. */
  function fake(lookups: Record<string, RuntimeLookup>): { adapter: SearchAdapter; calls: string[] } {
    const calls: string[] = []
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async (_ref, options) => ({
        items: [
          { title: 'A', externalRef: 'movie:1', ...(options?.runtimes === 'skip' ? {} : { timeToConsumeMinutes: 90 }) },
          { title: 'B', externalRef: 'movie:2', ...(options?.runtimes === 'skip' ? {} : { timeToConsumeMinutes: 100 }) },
          { title: 'Episode', timeToConsumeMinutes: 45 },
        ],
      }),
      enrich: async (refs) => {
        calls.push(...refs)
        return new Map(refs.map((ref) => [ref, lookups[ref]!]))
      },
    }

    return { adapter, calls }
  }

  it('lists without runtimes, enriches only the items that lack one and have a ref, and fills them in', async () => {
    const { adapter, calls } = fake({
      'movie:1': { status: 'found', minutes: 90 },
      'movie:2': { status: 'found', minutes: 100 },
    })

    const expansion = await expandWithRuntimes(adapter, 'x:1')

    expect(calls).toEqual(['movie:1', 'movie:2'])
    expect(expansion.items.map((item) => item.timeToConsumeMinutes)).toEqual([90, 100, 45])
  })

  it('equals the plain inline expansion when every lookup succeeds', async () => {
    const { adapter } = fake({
      'movie:1': { status: 'found', minutes: 90 },
      'movie:2': { status: 'found', minutes: 100 },
    })

    expect(await expandWithRuntimes(adapter, 'x:1')).toEqual(await adapter.expand('x:1'))
  })

  it('leaves the length absent for a definitive "none" and for a failed lookup, so the caller marks it estimated', async () => {
    const { adapter } = fake({
      'movie:1': { status: 'none' },
      'movie:2': { status: 'failed', error: new Error('down') },
    })

    const expansion = await expandWithRuntimes(adapter, 'x:1')

    expect(expansion.items[0]).not.toHaveProperty('timeToConsumeMinutes')
    expect(expansion.items[1]).not.toHaveProperty('timeToConsumeMinutes')
  })

  it('just expands, in full, when the adapter has no enrich', async () => {
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => ({ items: [{ title: 'A', timeToConsumeMinutes: 30 }] }),
    }

    expect(await expandWithRuntimes(adapter, 'x:1')).toEqual({ items: [{ title: 'A', timeToConsumeMinutes: 30 }] })
  })

  it('keeps the status the expansion reported', async () => {
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => ({ items: [], status: 'complete' }),
      enrich: async () => new Map(),
    }

    expect((await expandWithRuntimes(adapter, 'x:1')).status).toBe('complete')
  })
})

/**
 * BL-013 / task 10.11b: only adapters with an honest upstream signal for the
 * list's production status may build their expansion by hand. Every other one
 * says so by going through `itemsOnly`. A new adapter therefore has to make
 * the choice out loud — and an adapter gaining a status is a deliberate edit
 * to this list, alongside a test proving the signal is honest.
 */
describe('adapters that report no status', () => {
  const ADAPTERS_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'adapters')
  // `composite` only delegates to the adapters it wraps.
  const REPORTS_STATUS = new Set(['tmdbTv', 'composite'])

  const adapterFiles = readdirSync(ADAPTERS_DIR)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => file.replace(/\.ts$/, ''))
    // `wikitext` is a parsing helper, not an adapter.
    .filter((name) => name !== 'wikitext')

  it.each(adapterFiles.filter((name) => !REPORTS_STATUS.has(name)))(
    '%s builds its expansion with itemsOnly',
    (name) => {
      const source = readFileSync(join(ADAPTERS_DIR, `${name}.ts`), 'utf8')

      expect(source).toMatch(/expand: itemsOnly\(/)
    },
  )
})
