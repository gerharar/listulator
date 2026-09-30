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
    expand: async () => ({ items: [
      { title: 'Iron Man', externalRef: 'movie:1', year: 2008, timeToConsumeMinutes: 126 },
      { title: 'Agents of S.H.I.E.L.D. — Season 1', externalRef: 'season:1:1', year: 2013 },
    ] }),
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

    // Every title is quoted, not just the ones that would otherwise be
    // ambiguous (a bare title containing ": ", like "UFC 2: No Way Out",
    // genuinely needs quotes to parse at all) — a human reviewing hundreds
    // of generated titles at a glance should not see some quoted and some
    // not depending on punctuation. See the docstring on `yamlString`.
    expect(text).toContain('title: "MCU (All Canon Releases)"')
    expect(text).toContain('{title: "Iron Man", year: 2008, minutes: 126}')
    expect(text).toContain('{title: "Agents of S.H.I.E.L.D. — Season 1", year: 2013}')
  })

  it("carries a candidate's tags into the generated YAML", async () => {
    const outPath = join(dir, 'discography.yaml')

    await runGenerateList(
      { category: 'mega', ref: 'franchise:1', title: 'Some Band', out: outPath },
      registryWith(
        fakeAdapter({
          expand: async () => ({ items: [
            { title: 'Global Evisceration', tags: ['Album', 'Live'] },
            { title: 'Eaten Back to Life' },
          ] }),
        }),
      ),
    )

    const text = readFileSync(outPath, 'utf8')
    const parsed = loadYaml(text) as { items: { title: string; tags?: string[] }[] }

    expect(parsed.items).toEqual([
      { title: 'Global Evisceration', tags: ['Album', 'Live'] },
      { title: 'Eaten Back to Life' },
    ])
    expect(text).toContain('{title: "Global Evisceration", tags: ["Album", "Live"]}')
  })

  it('quotes every title consistently even when some need it to parse and others do not', async () => {
    const outPath = join(dir, 'ufc.yaml')

    await runGenerateList(
      { category: 'mega', ref: 'franchise:1', title: 'UFC', out: outPath },
      registryWith(
        fakeAdapter({
          expand: async () => ({ items: [
            { title: 'UFC 100', externalRef: 'e:1', year: 2009 },
            { title: 'UFC 2: No Way Out', externalRef: 'e:2', year: 1994 },
          ] }),
        }),
      ),
    )

    const text = readFileSync(outPath, 'utf8')
    const parsed = loadYaml(text) as { items: { title: string; year: number }[] }

    expect(parsed.items).toEqual([
      { title: 'UFC 100', year: 2009 },
      { title: 'UFC 2: No Way Out', year: 1994 },
    ])
    expect(text).toContain('{title: "UFC 100", year: 2009}')
    expect(text).toContain('{title: "UFC 2: No Way Out", year: 1994}')
  })

  describe('sources whose terms forbid redistributing their data', () => {
    const registryFrom = (sourceName: string) =>
      createMediaTypeRegistry([
        { key: 'mega', label: 'Mega', sortOrder: 100, defaultDurationMinutes: 120, adapter: fakeAdapter(), sourceName },
      ])

    it.each(['TMDB', 'IGDB', 'Comic Vine'])('warns in search mode that a %s draft cannot be contributed', async (source) => {
      const result = await runGenerateList({ category: 'mega', query: 'marvel' }, registryFrom(source))

      expect(result.warning).toContain(source)
      expect(result.warning).toMatch(/cannot be contributed/)
    })

    it('warns in generate mode, and writes the warning into the file so it outlives the terminal', async () => {
      const outPath = join(dir, 'from-tmdb.yaml')

      const result = await runGenerateList(
        { category: 'mega', ref: 'franchise:1', title: 'From TMDB', out: outPath },
        registryFrom('TMDB'),
      )

      expect(result.warning).toMatch(/TMDB.*cannot be contributed/)
      const text = readFileSync(outPath, 'utf8')
      expect(text).toMatch(/^# Generated/)
      expect(text).toMatch(/^# .*TMDB.*cannot be contributed/m)
      expect((loadYaml(text) as { title: string }).title).toBe('From TMDB')
    })

    it('says nothing for a source that allows it', async () => {
      const outPath = join(dir, 'from-wikipedia.yaml')

      const result = await runGenerateList(
        { category: 'mega', ref: 'franchise:1', title: 'From Wikipedia', out: outPath },
        registryFrom('Wikipedia'),
      )

      expect(result.warning).toBeUndefined()
      expect(readFileSync(outPath, 'utf8')).not.toMatch(/cannot be contributed/)
    })
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
