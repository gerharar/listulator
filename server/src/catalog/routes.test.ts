import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'

describe('catalog HTTP API', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  async function createList(body: Record<string, unknown> = {}) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Jackie Chan movies', mediaType: 'movie', ...body },
    })

    return response
  }

  async function createItem(listId: string, body: Record<string, unknown> = {}) {
    return harness.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/items`,
      payload: { title: 'Police Story', timeToConsumeMinutes: 100, ...body },
    })
  }

  it('walks a list through its whole lifecycle', async () => {
    const created = await createList()
    expect(created.statusCode).toBe(201)
    const list = created.json()
    expect(list).toMatchObject({ title: 'Jackie Chan movies', mediaType: 'movie' })

    const index = await harness.app.inject({ method: 'GET', url: '/api/lists' })
    expect(index.json()).toHaveLength(1)

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(read.statusCode).toBe(200)
    expect(read.json().items).toEqual([])

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}`,
      payload: { title: 'Jackie Chan (renamed)' },
    })
    expect(patched.json().title).toBe('Jackie Chan (renamed)')

    const removed = await harness.app.inject({ method: 'DELETE', url: `/api/lists/${list.id}` })
    expect(removed.statusCode).toBe(204)

    const afterDelete = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(afterDelete.statusCode).toBe(404)
  })

  it('walks an item through its whole lifecycle', async () => {
    const list = (await createList()).json()

    const created = await createItem(list.id)
    expect(created.statusCode).toBe(201)
    const item = created.json()
    expect(item).toMatchObject({
      title: 'Police Story',
      timeToConsumeMinutes: 100,
      timeToConsumeIsEstimated: true,
      orderIndex: 0,
      consumedAt: null,
      // This route is the "add one item by hand" primitive (task 6.2) —
      // always 'manual', regardless of what the caller sends.
      source: 'manual',
    })

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}/items/${item.id}`,
      payload: { timeToConsumeMinutes: 101, timeToConsumeIsEstimated: false },
    })
    expect(patched.json()).toMatchObject({
      timeToConsumeMinutes: 101,
      timeToConsumeIsEstimated: false,
    })

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/items/${item.id}`,
    })
    expect(removed.statusCode).toBe(204)

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })
    expect(read.json().items).toEqual([])
  })

  it('lets a hand-typed item join, move between, and leave a group (task 6.6)', async () => {
    const list = (await createList()).json()

    const created = (await createItem(list.id, { group: 'Season 1' })).json()
    expect(created.group).toBe('Season 1')

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}/items/${created.id}`,
      payload: { group: 'Season 2' },
    })
    expect(moved.json().group).toBe('Season 2')

    const cleared = await harness.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}/items/${created.id}`,
      payload: { group: null },
    })
    expect(cleared.json().group).toBeNull()
  })

  it('checks an item off and back on again', async () => {
    const list = (await createList()).json()
    const item = (await createItem(list.id)).json()

    const consumed = await harness.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/items/${item.id}/consumed`,
      payload: { consumed: true },
    })
    expect(consumed.statusCode).toBe(200)
    expect(consumed.json().consumedAt).not.toBeNull()

    // Setting the same state again is not an error — retries and two open tabs
    // should not fail.
    const again = await harness.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/items/${item.id}/consumed`,
      payload: { consumed: true },
    })
    expect(again.statusCode).toBe(200)

    const unconsumed = await harness.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/items/${item.id}/consumed`,
      payload: { consumed: false },
    })
    expect(unconsumed.json().consumedAt).toBeNull()
  })

  it('returns items in order, with the list', async () => {
    const list = (await createList()).json()
    await createItem(list.id, { title: 'First' })
    await createItem(list.id, { title: 'Second' })
    await createItem(list.id, { title: 'Third' })

    const read = await harness.app.inject({ method: 'GET', url: `/api/lists/${list.id}` })

    expect(read.json().items.map((item: { title: string }) => item.title)).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  it('404s for lists and items that do not exist', async () => {
    const list = (await createList()).json()

    const missingList = await harness.app.inject({ method: 'GET', url: '/api/lists/nope' })
    expect(missingList.statusCode).toBe(404)

    const itemOnMissingList = await createItem('nope')
    expect(itemOnMissingList.statusCode).toBe(404)

    const missingItem = await harness.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/items/nope/consumed`,
      payload: { consumed: true },
    })
    expect(missingItem.statusCode).toBe(404)
  })

  it('rejects malformed input', async () => {
    const noTitle = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { mediaType: 'movie' },
    })
    expect(noTitle.statusCode).toBe(400)

    const emptyTitle = await createList({ title: '' })
    expect(emptyTitle.statusCode).toBe(400)

    const badSource = await createList({ source: 'telepathy' })
    expect(badSource.statusCode).toBe(400)

    const list = (await createList()).json()

    // A duration is required — ingestion decides the number when it is unknown,
    // the catalog never guesses (SPEC.md §5).
    const noDuration = await harness.app.inject({
      method: 'POST',
      url: `/api/lists/${list.id}/items`,
      payload: { title: 'Untimed' },
    })
    expect(noDuration.statusCode).toBe(400)

    const negativeDuration = await createItem(list.id, { timeToConsumeMinutes: -5 })
    expect(negativeDuration.statusCode).toBe(400)

    const emptyPatch = await harness.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}`,
      payload: {},
    })
    expect(emptyPatch.statusCode).toBe(400)
  })

  it('accepts every built-in category, including ones with no search adapter', async () => {
    // Wrestling and MMA have no usable public API, but a list must still be
    // creatable in them — manual entry is always available (SPEC.md §5).
    for (const mediaType of ['movie', 'book', 'wrestling', 'mma']) {
      const response = await createList({ title: `A ${mediaType} list`, mediaType })
      expect(response.statusCode).toBe(201)
      expect(response.json().mediaType).toBe(mediaType)
    }
  })

  it('rejects categories that are not in the registry', async () => {
    // Deliberately replaces 2.1's free-text behaviour: users pick from the
    // built-in set, which is what stops tv/TV/Television fragmenting buckets.
    for (const mediaType of ['youtube-playlist', 'TV', 'Movies', 'anything']) {
      const response = await createList({ title: 'Nope', mediaType })
      expect(response.statusCode).toBe(400)
    }
  })
})
