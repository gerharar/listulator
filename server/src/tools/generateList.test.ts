import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { load as loadYaml } from 'js-yaml'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'
import type { SearchAdapter } from '../ingestion/mediaTypes.js'
import { runGenerateList } from './generateList.js'

function fakeAdapter(overrides: Partial<SearchAdapter> = {}): SearchAdapter {
  return {
    isAvailable: () => true,
    search: async () => [
      { externalRef: 'franchise:1', title: 'Marvel Cinematic Universe', detail: 'Films and series' },
    ],
    expand: async () => [
      { title: 'Iron Man', externalRef: 'movie:1', year: 2008, timeToConsumeMinutes: 126 },
      { title: 'Agents of S.H.I.E.L.D. — Season 1', externalRef: 'season:1:1', year: 2013 },
    ],
    ...overrides,
  }
}

function registryWith(adapter: SearchAdapter | undefined) {
  return createMediaTypeRegistry([
    { key: 'mega', label: 'Mega', sortOrder: 100, defaultDurationMinutes: 120, ...(adapter ? { adapter } : {}) },
  ])
}

describe('runGenerateList', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'listulator-gen-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unknown category', async () => {
    await expect(runGenerateList({ category: 'nope', query: 'x' }, registryWith(fakeAdapter()))).rejects.toThrow(
      /Unknown category/,
    )
  })

  it('rejects a category with no adapter', async () => {
    await expect(runGenerateList({ category: 'mega', query: 'x' }, registryWith(undefined))).rejects.toThrow(
      /no search adapter/,
    )
  })

  it('rejects an unavailable adapter (e.g. missing API key)', async () => {
    await expect(
      runGenerateList({ category: 'mega', query: 'x' }, registryWith(fakeAdapter({ isAvailable: () => false }))),
    ).rejects.toThrow(/unavailable/)
  })

  it('search mode returns candidates without writing anything', async () => {
    const result = await runGenerateList({ category: 'mega', query: 'Marvel' }, registryWith(fakeAdapter()))

    expect(result).toEqual({
      mode: 'search',
      results: [{ externalRef: 'franchise:1', title: 'Marvel Cinematic Universe', detail: 'Films and series' }],
    })
  })

  it('generate mode requires a title', async () => {
    await expect(
      runGenerateList({ category: 'mega', ref: 'franchise:1' }, registryWith(fakeAdapter())),
    ).rejects.toThrow(/--title/)
  })

  it('generate mode writes a lists/-format YAML file, review-ready', async () => {
    const outPath = join(dir, 'mcu-all-canon.yaml')

    const result = await runGenerateList(
      { category: 'mega', ref: 'franchise:1', title: 'MCU (All Canon Releases)', out: outPath },
      registryWith(fakeAdapter()),
    )

    expect(result).toEqual({ mode: 'generate', path: outPath, itemCount: 2 })
    expect(existsSync(outPath)).toBe(true)

    const text = readFileSync(outPath, 'utf8')
    expect(text).toMatch(/^# Generated/)

    const parsed = loadYaml(text) as { title: string; category: string; items: unknown[] }
    expect(parsed.title).toBe('MCU (All Canon Releases)')
    expect(parsed.category).toBe('mega')
    expect(parsed.items).toEqual([
      { title: 'Iron Man', year: 2008, minutes: 126 },
      { title: 'Agents of S.H.I.E.L.D. — Season 1', year: 2013 },
    ])
  })

  it('refuses to overwrite an existing file without --force', async () => {
    const outPath = join(dir, 'mcu.yaml')
    const options = { category: 'mega', ref: 'franchise:1', title: 'MCU', out: outPath }

    await runGenerateList(options, registryWith(fakeAdapter()))
    await expect(runGenerateList(options, registryWith(fakeAdapter()))).rejects.toThrow(/already exists/)
    await expect(runGenerateList({ ...options, force: true }, registryWith(fakeAdapter()))).resolves.toMatchObject({
      mode: 'generate',
    })
  })

  it('creates the category directory when writing to the default path', async () => {
    const result = await runGenerateList(
      { category: 'mega', ref: 'franchise:1', title: 'A Fresh Franchise', out: join(dir, 'mega', 'fresh.yaml') },
      registryWith(fakeAdapter()),
    )

    expect(existsSync(result.mode === 'generate' ? result.path : '')).toBe(true)
  })
})
