import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { itemsOnly } from './expansion.js'

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
