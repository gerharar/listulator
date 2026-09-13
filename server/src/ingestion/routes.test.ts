import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { IngestionError } from './http.js'
import { createMediaTypeRegistry, DEFAULT_MEDIA_TYPES, type SearchAdapter } from './mediaTypes.js'

describe('GET /api/media-types', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('exposes every category so the UI can show buckets for unused ones', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveLength(DEFAULT_MEDIA_TYPES.length)
    expect(response.json()[0]).toEqual({
      key: 'movie',
      label: 'Movies',
      sortOrder: 10,
      defaultDurationMinutes: 120,
      searchAvailable: false,
    })
  })

  it('reports which categories can be searched and which cannot', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types' })
    const byKey = new Map(
      response.json().map((mediaType: { key: string; searchAvailable: boolean }) => [
        mediaType.key,
        mediaType.searchAvailable,
      ]),
    )

    // MusicBrainz needs no credentials, so music is searchable out of the box.
    expect(byKey.get('music')).toBe(true)
    // Movies and games depend on credentials, so these reflect the
    // environment rather than a fixed answer.
    expect(typeof byKey.get('movie')).toBe('boolean')
    expect(typeof byKey.get('game')).toBe('boolean')
    // Open Library and Wikipedia need no credentials either. Wrestling and MMA
    // were expected to stay manual-only — neither has a usable API — until
    // Wikipedia's maintained event tables turned out to cover them.
    expect(byKey.get('book')).toBe(true)
    expect(byKey.get('wrestling')).toBe(true)
    expect(byKey.get('mma')).toBe(true)
    // TV and animation depend on the same TMDB credentials as movies.
    expect(typeof byKey.get('tv')).toBe('boolean')
    expect(typeof byKey.get('animation')).toBe('boolean')
  })
})

describe('POST /api/lists/:listId/items/import', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  async function createList(mediaType = 'comic') {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Fantastic Four', mediaType },
    })

    return response.json()
  }

  async function importItems(listId: string, items: unknown[], source?: 'manual' | 'import') {
    return harness.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items/import`,
      payload: { items, ...(source ? { source } : {}) },
    })
  }

  it('adds items in order, in one request', async () => {
    const list = await createList()

    const response = await importItems(list.id, [
      { title: 'Issue #1' },
      { title: 'Issue #2' },
      { title: 'Issue #3' },
    ])

    expect(response.statusCode).toBe(201)
    expect(response.json().map((item: { orderIndex: number }) => item.orderIndex)).toEqual([0, 1, 2])

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(read.json().items.map((item: { title: string }) => item.title)).toEqual([
      'Issue #1',
      'Issue #2',
      'Issue #3',
    ])
  })

  it("fills a missing duration from the category's default, marked estimated", async () => {
    const list = await createList('comic')

    const response = await importItems(list.id, [{ title: 'Issue #1' }])

    // Comics default to ~15 min per standard issue (SPEC.md §5).
    expect(response.json()[0]).toMatchObject({
      timeToConsumeMinutes: 15,
      timeToConsumeIsEstimated: true,
    })
  })

  it('uses a different default for a different category', async () => {
    const list = await createList('game')

    const response = await importItems(list.id, [{ title: 'Assassin’s Creed' }])

    expect(response.json()[0]).toMatchObject({
      timeToConsumeMinutes: 600,
      timeToConsumeIsEstimated: true,
    })
  })

  it('defaults new items to import-sourced when the caller says nothing', async () => {
    const list = await createList()

    const response = await importItems(list.id, [{ title: 'Issue #1' }])

    expect(response.json()[0]).toMatchObject({ source: 'import' })
  })

  it("marks a batch manual when the caller says so — this endpoint also backs manual list-creation's item textarea", async () => {
    const list = await createList()

    const response = await importItems(list.id, [{ title: 'Issue #1' }], 'manual')

    expect(response.json()[0]).toMatchObject({ source: 'manual' })
  })

  it('keeps a supplied duration and marks it as known, not estimated', async () => {
    const list = await createList('movie')

    const response = await importItems(list.id, [
      { title: 'Police Story', timeToConsumeMinutes: 100 },
    ])

    expect(response.json()[0]).toMatchObject({
      timeToConsumeMinutes: 100,
      timeToConsumeIsEstimated: false,
    })
  })

  it('appends to a list that already has items', async () => {
    const list = await createList()
    await importItems(list.id, [{ title: 'Issue #1' }])

    const response = await importItems(list.id, [{ title: 'Issue #2' }])

    expect(response.json()[0].orderIndex).toBe(1)
  })

  it('feeds the derived stats, so imported items count toward completion', async () => {
    const list = await createList('comic')
    await importItems(list.id, [{ title: 'Issue #1' }, { title: 'Issue #2' }])

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })

    expect(read.json().stats).toMatchObject({
      totalItems: 2,
      completionPercent: 0,
      timeRemainingMinutes: 30,
    })
  })

  it('404s for a list that does not exist', async () => {
    const response = await importItems('nope', [{ title: 'Orphan' }])

    expect(response.statusCode).toBe(404)
  })

  it('rejects malformed imports', async () => {
    const list = await createList()

    expect((await importItems(list.id, [])).statusCode).toBe(400)
    expect((await importItems(list.id, [{ title: '' }])).statusCode).toBe(400)
    expect((await importItems(list.id, [{ notATitle: 'x' }])).statusCode).toBe(400)
    expect(
      (await importItems(list.id, [{ title: 'x', timeToConsumeMinutes: -1 }])).statusCode,
    ).toBe(400)
  })
})

describe('registry extensibility', () => {
  /**
   * The point of the registry is that adding a category is one entry — no
   * migration, no changes to `catalog` or `suggestions` (SPEC.md §5). This
   * proves it by adding one that exists nowhere in the source tree and driving
   * a full list lifecycle through it.
   */
  it('supports a category that the shipped code has never heard of', async () => {
    const harness = createTestApp({
      mediaTypes: createMediaTypeRegistry([
        ...DEFAULT_MEDIA_TYPES,
        { key: 'podcast', label: 'Podcasts', sortOrder: 100, defaultDurationMinutes: 55 },
      ]),
    })

    const exposed = await harness.app.inject({ method: 'GET', url: '/api/media-types' })
    expect(exposed.json().at(-1)).toMatchObject({ key: 'podcast', label: 'Podcasts' })

    const list = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Hardcore History', mediaType: 'podcast' },
    })
    expect(list.statusCode).toBe(201)

    const imported = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${list.json().id}/items/import`,
      payload: { items: [{ title: 'Blueprint for Armageddon I' }] },
    })
    // Picked up the new category's default duration with no other change.
    expect(imported.json()[0]).toMatchObject({
      timeToConsumeMinutes: 55,
      timeToConsumeIsEstimated: true,
    })

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.json().id}` })
    expect(read.json().stats).toMatchObject({ totalItems: 1, timeRemainingMinutes: 55 })

    await harness.cleanup()
  })

  it('still rejects that category when it is not registered', async () => {
    const harness = createTestApp()

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Hardcore History', mediaType: 'podcast' },
    })

    expect(response.statusCode).toBe(400)

    await harness.cleanup()
  })
})

describe('search and import from a source', () => {
  let harness: TestApp

  /** A stand-in adapter, so these tests never touch the network. */
  function fakeAdapter(overrides: Partial<SearchAdapter> = {}): SearchAdapter {
    return {
      isAvailable: () => true,
      search: async () => [{ externalRef: 'ref-1', title: 'Cannibal Corpse', detail: 'Group · US' }],
      expand: async () => [
        { title: 'Eaten Back to Life', externalRef: 'rg-1' },
        { title: 'The Bleeding', externalRef: 'rg-2', timeToConsumeMinutes: 47 },
      ],
      ...overrides,
    }
  }

  function withAdapter(adapter: SearchAdapter | undefined) {
    return createTestApp({
      mediaTypes: createMediaTypeRegistry([
        { key: 'music', label: 'Music', sortOrder: 10, defaultDurationMinutes: 45, ...(adapter ? { adapter } : {}) },
        // No adapter at all — wrestling and MMA are really like this.
        { key: 'wrestling', label: 'Wrestling', sortOrder: 20, defaultDurationMinutes: 150 },
      ]),
    })
  }

  afterEach(async () => {
    await harness?.cleanup()
  })

  it('finds sources that could become a whole list', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/music/search?q=cannibal',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().sources).toEqual([
      { externalRef: 'ref-1', title: 'Cannibal Corpse', detail: 'Group · US' },
    ])
  })

  it('builds a list from a chosen source, in one step', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'music', externalRef: 'ref-1', title: 'Cannibal Corpse' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      title: 'Cannibal Corpse',
      mediaType: 'music',
      source: 'api',
      externalRef: 'ref-1',
      stats: { totalItems: 2 },
    })

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${response.json().id}` })
    ).json().items

    // A duration the source knew is kept as fact; the rest fall back to the
    // category default and are marked estimated.
    expect(items).toMatchObject([
      {
        title: 'Eaten Back to Life',
        timeToConsumeMinutes: 45,
        timeToConsumeIsEstimated: true,
        source: 'import',
      },
      {
        title: 'The Bleeding',
        timeToConsumeMinutes: 47,
        timeToConsumeIsEstimated: false,
        source: 'import',
      },
    ])
  })

  it('says search is unavailable for a category with no adapter, and points at manual entry', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/wrestling/search?q=wrestlemania',
    })

    expect(response.statusCode).toBe(409)
    // The code and its values, not a sentence — the wording lives in the web
    // locale, and asserting on it here would put it back in two places.
    expect(response.json()).toEqual({
      code: 'search.unavailable',
      params: { category: 'Wrestling' },
    })
  })

  it('treats a configured-but-unusable adapter the same way', async () => {
    // What a missing API key looks like: the adapter exists, it just cannot run.
    harness = withAdapter(fakeAdapter({ isAvailable: () => false }))

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/music/search?q=x',
    })

    expect(response.statusCode).toBe(409)
  })

  it('reports an upstream failure as upstream, not as a bug here', async () => {
    harness = withAdapter(
      fakeAdapter({
        search: async () => {
          throw new IngestionError('MusicBrainz is rate-limiting us. Try again in a moment.')
        },
      }),
    )

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/music/search?q=x',
    })

    expect(response.statusCode).toBe(502)
    expect(response.json().message).toMatch(/rate-limiting/)
  })

  it('does not leave an empty list behind when a source expands to nothing', async () => {
    harness = withAdapter(fakeAdapter({ expand: async () => [] }))

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'music', externalRef: 'ref-1', title: 'Nothing' },
    })

    expect(response.statusCode).toBe(422)
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
  })

  it('rejects an empty query rather than searching for nothing', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/music/search?q=%20%20',
    })

    expect(response.statusCode).toBe(400)
  })

  it('404s for a category that does not exist', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/nonsense/search?q=x',
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('creating a list from a custom-list file', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  function fromFile(yaml: string) {
    return harness.app.inject({ method: 'POST', url: '/api/lists/from-file', payload: { yaml } })
  }

  it('creates a real list with correct items, durations, and years', async () => {
    const yaml = `
title: Rocky Films
category: movie
items:
  - { title: Rocky, year: 1976, minutes: 120 }
  - { title: Rocky II, year: 1979 }
`
    const response = await fromFile(yaml)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      title: 'Rocky Films',
      mediaType: 'movie',
      source: 'file',
      externalRef: null,
      stats: { totalItems: 2 },
    })

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${response.json().id}` })
    ).json().items

    // A duration the file gave is kept as fact; an omitted one falls back to
    // the category default and is marked estimated, same rule as every
    // other ingestion path.
    expect(items).toMatchObject([
      { title: 'Rocky', year: 1976, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: false, source: 'import' },
      { title: 'Rocky II', year: 1979, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, source: 'import' },
    ])
  })

  it('preserves a group label per item', async () => {
    const yaml = 'title: X\ncategory: tv\nitems:\n  - { title: Pilot, group: Season 1 }\n'
    const response = await fromFile(yaml)

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${response.json().id}` })
    ).json().items

    expect(items).toMatchObject([{ title: 'Pilot', group: 'Season 1' }])
  })

  it('rejects an unknown category with the same code the search-based path uses', async () => {
    const response = await fromFile('title: X\ncategory: not-a-category\nitems:\n  - { title: X }\n')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.unknownCategory', params: { key: 'not-a-category' } })
  })

  it('rejects a missing title with a specific code, not a partial list', async () => {
    const response = await fromFile('category: movie\nitems:\n  - { title: X }\n')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.fileMissingTitle' })

    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
  })

  it('rejects an item missing a title, naming its position, creating nothing', async () => {
    const response = await fromFile(
      'title: X\ncategory: movie\nitems:\n  - { title: First }\n  - { year: 2000 }\n',
    )

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.fileItemMissingTitle', params: { index: 2 } })

    // Not a partial import: the whole file is rejected before any list exists.
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
  })

  it('rejects unparseable YAML', async () => {
    const response = await fromFile('title: [unclosed')

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.fileInvalid' })
  })
})

describe('scanning the local drop folder for custom-list files', () => {
  let harness: TestApp
  let dropDir: string

  beforeEach(() => {
    dropDir = mkdtempSync(join(tmpdir(), 'listulator-drop-route-'))
    harness = createTestApp({ listsDropDir: dropDir })
  })

  afterEach(async () => {
    await harness.cleanup()
    rmSync(dropDir, { recursive: true, force: true })
  })

  function drop(fileName: string, contents: string): void {
    writeFileSync(join(dropDir, fileName), contents)
  }

  function scan() {
    return harness.app.inject({ method: 'POST', url: '/api/lists/scan-folder' })
  }

  it('imports a valid dropped file exactly as the upload path would', async () => {
    drop('good.yaml', 'title: Rocky Films\ncategory: movie\nitems:\n  - { title: Rocky, year: 1976 }\n')

    const response = await scan()

    expect(response.statusCode).toBe(201)
    expect(response.json().created).toEqual([
      { fileName: 'good.yaml', id: expect.any(String), title: 'Rocky Films' },
    ])
    expect(response.json().failed).toEqual([])

    const list = (await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()[0]
    expect(list).toMatchObject({ title: 'Rocky Films', mediaType: 'movie', source: 'file' })
    expect(existsSync(join(dropDir, 'admitted', 'good.yaml'))).toBe(true)
  })

  it('reports an invalid dropped file, not silently skipping or half-importing it', async () => {
    drop('bad.yaml', 'category: movie\nitems:\n  - { title: X }\n')

    const response = await scan()

    expect(response.statusCode).toBe(200)
    expect(response.json().created).toEqual([])
    expect(response.json().failed).toEqual([{ fileName: 'bad.yaml', code: 'list.fileMissingTitle' }])
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
    expect(existsSync(join(dropDir, 'refused_entry', 'bad.yaml'))).toBe(true)
  })

  it('imports the good files and reports the bad one in a single mixed scan', async () => {
    drop('good.yaml', 'title: Good\ncategory: movie\nitems:\n  - { title: X }\n')
    drop('bad.yaml', 'title: [unclosed')

    const response = await scan()

    expect(response.statusCode).toBe(201)
    expect(response.json().created).toEqual([{ fileName: 'good.yaml', id: expect.any(String), title: 'Good' }])
    expect(response.json().failed).toEqual([{ fileName: 'bad.yaml', code: 'list.fileInvalid' }])
  })

  it('does nothing on an empty or missing folder', async () => {
    const response = await scan()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ created: [], failed: [] })
  })

  it('a repeated scan does not re-import an already-admitted file', async () => {
    drop('good.yaml', 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')
    await scan()

    const second = await scan()

    expect(second.json()).toEqual({ created: [], failed: [] })
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toHaveLength(1)
  })
})

describe('checking a list for updates', () => {
  let harness: TestApp

  /** Expands to a franchise that grows by one entry when `extra` is set. */
  function adapterYielding(titles: { title: string; externalRef?: string }[]): SearchAdapter {
    return {
      isAvailable: () => true,
      search: async () => [{ externalRef: 'franchise:1', title: 'A franchise' }],
      expand: async () => titles,
    }
  }

  function appWith(adapter: SearchAdapter | undefined) {
    return createTestApp({
      mediaTypes: createMediaTypeRegistry([
        {
          key: 'game',
          label: 'Games',
          sortOrder: 10,
          defaultDurationMinutes: 600,
          ...(adapter ? { adapter } : {}),
        },
      ]),
    })
  }

  async function buildList(app: TestApp) {
    const response = await app.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'game', externalRef: 'franchise:1', title: 'A franchise' },
    })

    return response.json()
  }

  afterEach(async () => {
    await harness?.cleanup()
  })

  it('reports nothing when the source has not moved', async () => {
    const items = [
      { title: 'One', externalRef: 'game:1' },
      { title: 'Two', externalRef: 'game:2' },
    ]
    harness = appWith(adapterYielding(items))
    const list = await buildList(harness)

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/refresh`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ newItems: [], upstreamCount: 2, existingCount: 2 })
  })

  it('reports only what is genuinely new', async () => {
    let upstream = [{ title: 'One', externalRef: 'game:1' }]
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => upstream,
    }

    harness = appWith(adapter)
    const list = await buildList(harness)

    // The franchise gains a game.
    upstream = [
      { title: 'One', externalRef: 'game:1' },
      { title: 'Two', externalRef: 'game:2' },
    ]

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/refresh`,
    })

    expect(response.json().newItems).toEqual([{ title: 'Two', externalRef: 'game:2' }])
  })

  it('matches on upstream id, so a rename is not mistaken for a new item', async () => {
    let upstream = [{ title: 'Working Title', externalRef: 'game:1' }]
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => upstream,
    }

    harness = appWith(adapter)
    const list = await buildList(harness)

    upstream = [{ title: 'Final Title', externalRef: 'game:1' }]

    expect(
      (await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })).json()
        .newItems,
    ).toEqual([])
  })

  it('falls back to matching on title for sources with no id', async () => {
    // Wikipedia events and Open Library works carry no stable id.
    let upstream = [{ title: 'WrestleMania (1985)' }]
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => upstream,
    }

    harness = appWith(adapter)
    const list = await buildList(harness)

    upstream = [{ title: 'wrestlemania (1985)  ' }, { title: 'SummerSlam (1988)' }]

    expect(
      (await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })).json()
        .newItems,
    ).toEqual([{ title: 'SummerSlam (1988)' }])
  })

  it('changes nothing by itself', async () => {
    // Applying automatically would put back everything the user pruned, which
    // makes pruning pointless. The caller decides what to add.
    let upstream = [{ title: 'One', externalRef: 'game:1' }]
    const adapter: SearchAdapter = {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => upstream,
    }

    harness = appWith(adapter)
    const list = await buildList(harness)

    upstream = [
      { title: 'One', externalRef: 'game:1' },
      { title: 'Two', externalRef: 'game:2' },
    ]

    await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })

    const after = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(after.json().items).toHaveLength(1)
  })

  it('does not offer back an item the user deleted', async () => {
    // The promise that makes imperfect import filtering acceptable: prune what
    // you do not want and it stays pruned. Without this every rescan hands
    // back the entries you already removed.
    const upstream = [
      { title: 'The Show', externalRef: 'movie:1' },
      { title: 'Behind the Scenes', externalRef: 'movie:2' },
    ]

    harness = appWith(adapterYielding(upstream))
    const list = await buildList(harness)

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    ).json().items
    const unwanted = items.find(
      (item: { title: string }) => item.title === 'Behind the Scenes',
    )

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/items/${unwanted.id}`,
    })

    const refreshed = (
      await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })
    ).json()

    expect(refreshed.newItems).toEqual([])
    expect(refreshed.dismissedCount).toBe(1)
  })

  it('offers deleted items back when asked to', async () => {
    // The undo for deleting something by accident, and the way out when a
    // shared title suppressed more than it should have.
    const upstream = [{ title: 'Deleted By Mistake', externalRef: 'movie:1' }]

    harness = appWith(adapterYielding(upstream))
    const list = await buildList(harness)

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    ).json().items

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/items/${items[0].id}`,
    })

    const refreshed = (
      await harness.app.inject({
        method: 'POST',
        url: `/api/lists/${list.id}/refresh`,
        payload: { includeDismissed: true },
      })
    ).json()

    expect(refreshed.newItems).toEqual(upstream)
  })

  it('forgets a dismissal once the item is added back', async () => {
    // Otherwise restoring something would work once, and the next ordinary
    // rescan would hide it again.
    const upstream = [{ title: 'Restored', externalRef: 'movie:1' }]

    harness = appWith(adapterYielding(upstream))
    const list = await buildList(harness)

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    ).json().items

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/items/${items[0].id}`,
    })
    await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/items/import`,
      payload: { items: upstream },
    })

    // Back in the list, and no longer on the dismissed record.
    const refreshed = (
      await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })
    ).json()

    expect(refreshed.dismissedCount).toBe(0)
    expect(refreshed.newItems).toEqual([])
  })

  it('dismisses by title where the source has no id', async () => {
    const upstream = [{ title: 'UFC 1' }, { title: 'UFC 2' }]

    harness = appWith(adapterYielding(upstream))
    const list = await buildList(harness)

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    ).json().items
    const first = items.find((item: { title: string }) => item.title === 'UFC 1')

    await harness.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/items/${first.id}`,
    })

    expect(
      (await harness.app.inject({ method: 'POST', url: `/api/lists/${list.id}/refresh` })).json()
        .newItems,
    ).toEqual([])
  })

  it('refuses a list that was made by hand', async () => {
    harness = appWith(adapterYielding([]))
    const manual = (
      await harness.app.inject({
        method: 'POST',
        url: '/api/lists',
        payload: { title: 'By hand', mediaType: 'game' },
      })
    ).json()

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${manual.id}/refresh`,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ code: 'refresh.handMadeList' })
  })

  it('404s for a list that does not exist', async () => {
    harness = appWith(adapterYielding([]))

    expect(
      (await harness.app.inject({ method: 'POST', url: '/api/lists/nope/refresh' })).statusCode,
    ).toBe(404)
  })
})

describe('canonical lists surfaced through search (task 7.4)', () => {
  let harness: TestApp

  const MANIFEST_URL = 'https://raw.githubusercontent.com/neuroshaoh/listulator/main/lists/index.json'
  const MCU_URL = 'https://raw.githubusercontent.com/neuroshaoh/listulator/main/lists/mega/mcu.yaml'
  const MCU_YAML = 'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n'

  const MANIFEST = [
    { path: 'lists/mega/mcu.yaml', title: 'Marvel Cinematic Universe', category: 'mega' },
    { path: 'lists/book/lotr.yaml', title: 'The Lord of the Rings', category: 'book' },
  ]

  function mockGitHub(routes: Record<string, { body: string; status?: number }>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const route = routes[url]
        if (!route) throw new Error(`unexpected fetch: ${url}`)
        return new Response(route.body, { status: route.status ?? 200 })
      }),
    )
  }

  /** `book` has a real always-available adapter (Open Library); `wrestling` here has none. */
  function appWithRegistry() {
    return createTestApp({
      mediaTypes: createMediaTypeRegistry([
        {
          key: 'mega',
          label: 'Mega',
          sortOrder: 10,
          defaultDurationMinutes: 120,
          // No adapter at all — proves a canonical match alone is enough.
        },
        {
          key: 'book',
          label: 'Books',
          sortOrder: 20,
          defaultDurationMinutes: 240,
          adapter: {
            isAvailable: () => true,
            search: async () => [{ externalRef: 'ol:OL1A', title: 'A Real Author' }],
            expand: async () => [{ title: 'A Real Book' }],
          },
        },
      ]),
    })
  }

  beforeEach(() => {
    harness = appWithRegistry()
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.unstubAllGlobals()
  })

  it('matches a canonical list title within the same category', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/mega/search?q=marvel' })

    expect(response.statusCode).toBe(200)
    expect(response.json().sources).toEqual([
      { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'Marvel Cinematic Universe', detail: 'Canonical list' },
    ])
  })

  it('is case-insensitive and matches a substring, not just an exact title', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/mega/search?q=MARVEL' })

    expect(response.json().sources).toHaveLength(1)
  })

  it('never matches a canonical list from a different category', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    // "lord" matches the LOTR manifest entry's title, but that entry is
    // category "book" — searching "book" (which has a real adapter) must not
    // pick it up.
    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/book/search?q=marvel' })

    expect(response.statusCode).toBe(200)
    expect(response.json().sources).toEqual([{ externalRef: 'ol:OL1A', title: 'A Real Author' }])
  })

  it('works for a category with no adapter at all, where search would otherwise be unavailable', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/mega/search?q=marvel' })

    expect(response.statusCode).toBe(200)
  })

  it('still reports search.unavailable when neither the adapter nor a canonical match exists', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/mega/search?q=nothing-real' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ code: 'search.unavailable', params: { category: 'Mega' } })
  })

  it('merges canonical matches alongside a real, available adapter\'s own results', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: JSON.stringify(MANIFEST) } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/book/search?q=lord' })

    expect(response.json().sources).toEqual([
      { externalRef: 'canonical:lists/book/lotr.yaml', title: 'The Lord of the Rings', detail: 'Canonical list' },
      { externalRef: 'ol:OL1A', title: 'A Real Author' },
    ])
  })

  it('degrades to the adapter\'s own results alone when the canonical repo is unreachable', async () => {
    mockGitHub({ [MANIFEST_URL]: { body: '404: Not Found', status: 404 } })

    const response = await harness.app.inject({ method: 'GET', url: '/api/media-types/book/search?q=lord' })

    expect(response.statusCode).toBe(200)
    expect(response.json().sources).toEqual([{ externalRef: 'ol:OL1A', title: 'A Real Author' }])
  })

  it('builds a list from a chosen canonical search result, recording a canonical: externalRef', async () => {
    mockGitHub({ [MCU_URL]: { body: MCU_YAML } })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: {
        mediaType: 'mega',
        externalRef: 'canonical:lists/mega/mcu.yaml',
        title: 'Marvel Cinematic Universe',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      title: 'Marvel Cinematic Universe',
      mediaType: 'mega',
      source: 'canonical',
      externalRef: 'canonical:lists/mega/mcu.yaml',
    })

    const items = (
      await harness.app.inject({ method: 'GET', url: `/api/lists/${response.json().id}` })
    ).json().items
    expect(items).toMatchObject([{ title: 'Iron Man', year: 2008, source: 'import' }])
  })

  it('rejects a path-traversal attempt before any fetch happens', async () => {
    mockGitHub({}) // any call at all fails the test

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: {
        mediaType: 'mega',
        externalRef: 'canonical:../../other-repo/main/x.yaml',
        title: 'X',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.fileInvalid' })
  })

  it('reports a parse error in the canonical file with a specific code, building nothing', async () => {
    mockGitHub({ [MCU_URL]: { body: 'title: X\ncategory: not-real\nitems: []\n' } })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'mega', externalRef: 'canonical:lists/mega/mcu.yaml', title: 'X' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.unknownCategory', params: { key: 'not-real' } })
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()).toEqual([])
  })

})

describe('refresh support for synced canonical lists (task 7.5)', () => {
  let harness: TestApp

  const MCU_URL = 'https://raw.githubusercontent.com/neuroshaoh/listulator/main/lists/mega/mcu.yaml'

  function mockGitHub(routes: Record<string, { body: string; status?: number }>) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const route = routes[url]
        if (!route) throw new Error(`unexpected fetch: ${url}`)
        return new Response(route.body, { status: route.status ?? 200 })
      }),
    )
  }

  async function syncMcu(bodyYaml: string) {
    mockGitHub({ [MCU_URL]: { body: bodyYaml } })

    const created = (
      await harness.app.inject({
        method: 'POST',
        url: '/api/lists/from-source',
        payload: {
          mediaType: 'mega',
          externalRef: 'canonical:lists/mega/mcu.yaml',
          title: 'Marvel Cinematic Universe',
        },
      })
    ).json()

    return created
  }

  beforeEach(() => {
    harness = createTestApp({
      mediaTypes: createMediaTypeRegistry([
        // No adapter at all — proves refresh works from the canonical
        // externalRef alone, the same as search did in task 7.4.
        { key: 'mega', label: 'Mega', sortOrder: 10, defaultDurationMinutes: 120 },
      ]),
    })
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.unstubAllGlobals()
  })

  it('offers a new item that appeared upstream since import', async () => {
    const created = await syncMcu(
      'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n',
    )

    mockGitHub({
      [MCU_URL]: {
        body:
          'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n' +
          '  - { title: Iron Man, year: 2008 }\n' +
          '  - { title: The Incredible Hulk, year: 2008 }\n',
      },
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${created.id}/refresh`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      newItems: [{ title: 'The Incredible Hulk', year: 2008 }],
      upstreamCount: 2,
      existingCount: 1,
    })
  })

  it('does not re-offer an item already imported, matched on title', async () => {
    const created = await syncMcu(
      'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n',
    )

    mockGitHub({
      [MCU_URL]: {
        body: 'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n',
      },
    })

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${created.id}/refresh`,
    })

    expect(response.json().newItems).toEqual([])
  })

  it('reports a parse error in the re-fetched file with a specific code, changing nothing', async () => {
    const created = await syncMcu(
      'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n',
    )

    mockGitHub({ [MCU_URL]: { body: 'title: X\ncategory: not-real\nitems: []\n' } })

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${created.id}/refresh`,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ code: 'list.unknownCategory', params: { key: 'not-real' } })
  })

  it('surfaces a 502 rather than degrading silently when the canonical repo is unreachable', async () => {
    const created = await syncMcu(
      'title: Marvel Cinematic Universe\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n',
    )

    mockGitHub({ [MCU_URL]: { body: '404: Not Found', status: 404 } })

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${created.id}/refresh`,
    })

    expect(response.statusCode).toBe(502)
  })
})
