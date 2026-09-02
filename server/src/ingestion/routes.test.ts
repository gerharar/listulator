import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    // Movies depend on a TMDB key, so this reflects the environment rather
    // than a fixed answer.
    expect(typeof byKey.get('movie')).toBe('boolean')
    // Wrestling and MMA have no usable public API and may never be searchable;
    // the rest are waiting on adapters.
    expect(byKey.get('wrestling')).toBe(false)
    expect(byKey.get('mma')).toBe(false)
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

  async function importItems(listId: string, items: unknown[]) {
    return harness.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items/import`,
      payload: { items },
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
      { title: 'Eaten Back to Life', timeToConsumeMinutes: 45, timeToConsumeIsEstimated: true },
      { title: 'The Bleeding', timeToConsumeMinutes: 47, timeToConsumeIsEstimated: false },
    ])
  })

  it('says search is unavailable for a category with no adapter, and points at manual entry', async () => {
    harness = withAdapter(fakeAdapter())

    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/media-types/wrestling/search?q=wrestlemania',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toMatch(/by hand/)
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
