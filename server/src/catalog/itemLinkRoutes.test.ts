import { afterEach, describe, expect, it, vi } from 'vitest'
import { users } from '../db/schema.js'
import { createMediaTypeRegistry, type MediaType } from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem } from './repository.js'

/**
 * H-002 (BL-087): a list's own read says, for each item, where its page at the source is: the adapter's `itemUrl`
 * answer, with the category's source name, or null. The item's own responses (create, edit) do not carry it, as
 * with `runtimePending`: the screen re-reads the list after an edit.
 */

const withLinks: MediaType = {
  key: 'movie',
  label: 'Movies',
  sortOrder: 10,
  defaultDurationMinutes: 120,
  sourceName: 'Fake Source',
  adapter: {
    isAvailable: () => true,
    search: async () => [],
    expand: async () => ({ items: [] }),
    // Tells the list ref and the item apart, so a test can see both arrived.
    itemUrl: (item, listExternalRef) => (item.externalRef ? `https://example.org/${listExternalRef ?? 'none'}/${item.externalRef}` : undefined),
  },
}

const withoutLinks: MediaType = {
  key: 'plain',
  label: 'Plain',
  sortOrder: 20,
  defaultDurationMinutes: 45,
  sourceName: 'Plain Source',
  adapter: { isAvailable: () => true, search: async () => [], expand: async () => ({ items: [] }) },
}

describe('GET /lists/:id: the link on each item (H-002)', () => {
  let harness: TestApp
  afterEach(async () => harness?.cleanup())

  const build = () => createTestApp({ mediaTypes: createMediaTypeRegistry([withLinks, withoutLinks]) })

  const userId = async () => {
    await harness.app.ready()

    return harness.db.select().from(users).get()!.id
  }

  const readItems = async (id: string) =>
    (await harness.app.inject({ method: 'GET', url: `/api/lists/${id}` })).json().items as { title: string; link: { url: string; source: string } | null }[]

  it('gives an imported item its adapter’s link and the source’s name, and passes the list’s own ref', async () => {
    harness = build()
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Films', mediaType: 'movie', source: 'api', externalRef: 'person:1' })
    await createListItem(harness.db, owner, list.id, { title: 'Imported', timeToConsumeMinutes: 90, externalRef: 'movie:7', source: 'import' })

    expect((await readItems(list.id))[0]!.link).toEqual({ url: 'https://example.org/person:1/movie:7', source: 'Fake Source' })
  })

  it('gives none to an item with no ref, and none to one typed in by hand', async () => {
    harness = build()
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Films', mediaType: 'movie', source: 'api', externalRef: 'person:1' })
    await createListItem(harness.db, owner, list.id, { title: 'No ref', timeToConsumeMinutes: 90, source: 'import' })
    await createListItem(harness.db, owner, list.id, { title: 'By hand', timeToConsumeMinutes: 90, externalRef: 'movie:8', source: 'manual' })

    expect((await readItems(list.id)).map((item) => [item.title, item.link])).toEqual([
      ['No ref', null],
      ['By hand', null],
    ])
  })

  it('gives none in a category whose adapter has no item pages', async () => {
    harness = build()
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Plain', mediaType: 'plain', source: 'api', externalRef: 'x' })
    await createListItem(harness.db, owner, list.id, { title: 'Imported', timeToConsumeMinutes: 10, externalRef: 'movie:7', source: 'import' })

    expect((await readItems(list.id))[0]!.link).toBeNull()
  })

  it('gives none to a hand-made list’s items', async () => {
    harness = build()
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Mine', mediaType: 'movie' })
    await createListItem(harness.db, owner, list.id, { title: 'Hand', timeToConsumeMinutes: 10, source: 'manual' })

    expect((await readItems(list.id))[0]!.link).toBeNull()
  })
})

/**
 * IGDB's pages need a slug the item does not carry: the list's own read says the links are on their way
 * (`linkPending`) while a background lookup runs, and gives them once it has answered. A category with nothing to
 * look up pays nothing, and a list the source cannot answer for is not called "pending" for ever.
 */
describe('GET /lists/:id: links that need a slug looked up first (H-002, IGDB)', () => {
  let harness: TestApp
  afterEach(async () => harness?.cleanup())

  const slugs = vi.fn(async (refs: string[]) => new Map(refs.map((ref): [string, string | null] => [ref, `slug-${ref.slice(5)}`])))
  const game = (overrides: Partial<NonNullable<MediaType['adapter']>> = {}): MediaType => ({
    key: 'game',
    label: 'Games',
    sortOrder: 10,
    defaultDurationMinutes: 600,
    sourceName: 'IGDB',
    adapter: {
      isAvailable: () => true,
      search: async () => [],
      expand: async () => ({ items: [] }),
      slugPrefixes: ['game'],
      slugs,
      itemUrl: (item) => (item.externalRef && item.slug ? `https://example.org/games/${item.slug}` : undefined),
      ...overrides,
    },
  })

  const build = (type: MediaType, slugFill: { cooldownMs?: number } = {}) => {
    slugs.mockClear()
    harness = createTestApp({ mediaTypes: createMediaTypeRegistry([type, withoutLinks]), slugFill })
  }

  const userId = async () => {
    await harness.app.ready()

    return harness.db.select().from(users).get()!.id
  }

  const listWithGames = async (mediaType = 'game') => {
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Games', mediaType, source: 'api', externalRef: 'franchise:1' })
    for (const n of [1, 2]) {
      await createListItem(harness.db, owner, list.id, { title: `Game ${n}`, timeToConsumeMinutes: 600, externalRef: `game:${n}`, source: 'import' })
    }

    return list
  }

  const read = async (id: string) =>
    (await harness.app.inject({ method: 'GET', url: `/api/lists/${id}` })).json().items as { title: string; link: { url: string } | null; linkPending?: boolean }[]

  it('says the links are coming on the first opening, and gives them once the lookup has answered', async () => {
    build(game())
    const list = await listWithGames()

    expect((await read(list.id)).map((item) => [item.link, item.linkPending])).toEqual([[null, true], [null, true]])

    await harness.app.slugFiller.idle(list.id)

    expect((await read(list.id)).map((item) => [item.link?.url, item.linkPending])).toEqual([
      ['https://example.org/games/slug-1', undefined],
      ['https://example.org/games/slug-2', undefined],
    ])
  })

  it('asks the source once for the list, however often it is read meanwhile', async () => {
    build(game())
    const list = await listWithGames()

    await read(list.id)
    await read(list.id)
    await read(list.id)
    await harness.app.slugFiller.idle(list.id)

    expect(slugs).toHaveBeenCalledTimes(1)
  })

  it('asks nothing when the next opening finds every answer held', async () => {
    build(game())
    const list = await listWithGames()
    await read(list.id)
    await harness.app.slugFiller.idle(list.id)
    slugs.mockClear()

    await read(list.id)

    expect(slugs).not.toHaveBeenCalled()
  })

  it('does not call the links pending when the source cannot answer (no key), or after a failure', async () => {
    build(game({ isAvailable: () => false }))
    const keyless = await listWithGames()
    expect((await read(keyless.id)).every((item) => item.linkPending === undefined)).toBe(true)
    expect(slugs).not.toHaveBeenCalled()
    await harness.cleanup()

    build(game({ slugs: async () => Promise.reject(new Error('IGDB is down')) }), { cooldownMs: 60_000 })
    const failing = await listWithGames()
    expect((await read(failing.id)).every((item) => item.linkPending === true)).toBe(true)
    await harness.app.slugFiller.idle(failing.id)
    expect((await read(failing.id)).every((item) => item.linkPending === undefined && item.link === null)).toBe(true)
  })

  it('costs a category with no slugs nothing: no field, no lookup', async () => {
    build(game())
    const owner = await userId()
    const list = await createList(harness.db, owner, { title: 'Plain', mediaType: 'plain', source: 'api', externalRef: 'x' })
    await createListItem(harness.db, owner, list.id, { title: 'A', timeToConsumeMinutes: 10, externalRef: 'game:1', source: 'import' })

    expect((await read(list.id))[0]).not.toHaveProperty('linkPending')
    expect(slugs).not.toHaveBeenCalled()
  })
})
