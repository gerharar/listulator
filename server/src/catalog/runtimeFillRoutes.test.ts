import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { itemRuntimes, listItems, users } from '../db/schema.js'
import type { ExpandOptions, MediaTypeCandidate, RuntimeLookup, SearchAdapter } from '../ingestion/mediaTypes.js'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem } from './repository.js'

/**
 * Task 15.5: a list is built at once from a listing, with the category's estimate for every length, and
 * the lengths are looked up afterwards by the background runner.
 */

const DEFAULT_MINUTES = 120

/** A source of films `film:N`, 1 to 3 and 2 to 4 under two refs, that can skip and later look lengths up. */
function filmSource(options: { answer?: (ref: string) => RuntimeLookup } = {}) {
  /** While held, a lookup does not answer: the state "just built, nothing looked up yet" can be seen. */
  let gate: Promise<void> | undefined
  const hold = (): (() => void) => {
    let release!: () => void
    gate = new Promise<void>((resolve) => (release = resolve))

    return release
  }

  const expand = vi.fn(async (ref: string, expandOptions?: ExpandOptions) => {
    const numbers = ref === 'first' ? [1, 2, 3] : ref === 'second' ? [2, 3, 4] : Array.from({ length: 10 }, (_, index) => index + 1)

    return {
      items: numbers.map(
        (n): MediaTypeCandidate => ({
          title: `Film ${n}`,
          externalRef: `film:${n}`,
          // Inline expansions carry the length; a listing does not.
          ...(expandOptions?.runtimes === 'skip' ? {} : { timeToConsumeMinutes: 100 + n }),
        }),
      ),
    }
  })
  const enrich = vi.fn(async (refs: string[]) => {
    await gate
    return new Map(refs.map((ref): [string, RuntimeLookup] => [ref, options.answer?.(ref) ?? { status: 'found', minutes: 100 + Number(ref.split(':')[1]) }]))
  })
  const adapter: SearchAdapter = {
    isAvailable: () => true,
    search: async () => [{ externalRef: 'first', title: 'First' }],
    expand,
    enrich,
    enrichPrefixes: ['film'],
  }

  return { adapter, expand, enrich, hold }
}

describe('building a list at once and filling its lengths afterwards (15.5)', () => {
  let harness: TestApp
  const plainExpand = vi.fn<(ref: string) => Promise<{ items: MediaTypeCandidate[] }>>(async () => ({
    items: [{ title: 'A' }, { title: 'B', timeToConsumeMinutes: 30 }],
  }))

  const build = (source: SearchAdapter) =>
    createTestApp({
      mediaTypes: createMediaTypeRegistry([
        { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: DEFAULT_MINUTES, sourceName: 'Fake', sourceCopyMaxDays: 180, adapter: source },
        { key: 'plain', label: 'Plain', sortOrder: 20, defaultDurationMinutes: 45, adapter: { isAvailable: () => true, search: async () => [], expand: plainExpand } },
      ]),
      runtimeFill: { sleep: async () => undefined, limiterFor: () => undefined },
    })

  beforeEach(() => {
    plainExpand.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
  })

  afterEach(async () => {
    await harness?.cleanup()
    vi.unstubAllGlobals()
  })

  async function fromSource(externalRef: string, title = 'A list', mediaType = 'movie') {
    return harness.app.inject({ method: 'POST', url: '/api/lists/from-source', payload: { mediaType, externalRef, title } })
  }

  /** The default user exists once the app has started. */
  const userId = async () => {
    await harness.app.ready()

    return harness.db.select().from(users).get()!.id
  }

  const readList = async (id: string) => (await harness.app.inject({ method: 'GET', url: `/api/lists/${id}` })).json()

  it('lists the source without lengths, and creates the list at once with the estimate and the number still to look up', async () => {
    const source = filmSource()
    const release = source.hold()
    harness = build(source.adapter)

    const response = await fromSource('first')

    expect(response.statusCode).toBe(201)
    expect(source.expand).toHaveBeenCalledExactlyOnceWith('first', { runtimes: 'skip' })
    expect(response.json().stats).toMatchObject({ totalItems: 3, runtimesPending: 3 })

    const before = await readList(response.json().id)
    expect(before.items.map((item: { timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean }) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      [DEFAULT_MINUTES, true],
      [DEFAULT_MINUTES, true],
      [DEFAULT_MINUTES, true],
    ])

    release()
    await harness.app.runtimeFiller.fill(response.json().id)

    const after = await readList(response.json().id)
    expect(after.items.map((item: { timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean }) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      [101, false],
      [102, false],
      [103, false],
    ])
    expect(after.stats.runtimesPending).toBe(0)
  })

  it('starts the lookup after the reply and does not wait for it', async () => {
    const source = filmSource()
    const release = source.hold()
    harness = build(source.adapter)

    const response = await fromSource('first')

    // The request is over while the lookup is still held at the source.
    expect(response.statusCode).toBe(201)
    expect(source.enrich).toHaveBeenCalledTimes(1)
    release()
    await harness.app.runtimeFiller.fill(response.json().id)
  })

  it('gives a second list the lengths the first already looked up, complete at once and asking for nothing more', async () => {
    const source = filmSource()
    harness = build(source.adapter)
    const first = await fromSource('first', 'First')
    await harness.app.runtimeFiller.fill(first.json().id)
    source.enrich.mockClear()
    const release = source.hold()

    const second = await fromSource('second', 'Second')

    // Films 2 and 3 are known; only film 4 is new. The reply itself says so, before any lookup has run:
    // 102 + 103 for the known two and the estimate for the third, not three estimates.
    expect(second.json().stats).toMatchObject({ runtimesPending: 1, timeRemainingMinutes: 102 + 103 + DEFAULT_MINUTES })
    const items = (await readList(second.json().id)).items
    expect(items.map((item: { title: string; timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean }) => [item.title, item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      ['Film 2', 102, false],
      ['Film 3', 103, false],
      ['Film 4', DEFAULT_MINUTES, true],
    ])

    release()
    await harness.app.runtimeFiller.fill(second.json().id)
    expect(source.enrich.mock.calls.flat().flat()).toEqual(['film:4'])
  })

  it('keeps a lookup that failed pending, and the build still succeeds', async () => {
    harness = build(filmSource({ answer: (ref) => (ref === 'film:2' ? { status: 'failed', error: new Error('down') } : { status: 'found', minutes: 90 }) }).adapter)

    const response = await fromSource('first')
    expect(response.statusCode).toBe(201)
    await harness.app.runtimeFiller.fill(response.json().id)

    expect((await readList(response.json().id)).stats.runtimesPending).toBe(1)
    expect(harness.db.select().from(itemRuntimes).where(eq(itemRuntimes.ref, 'film:2')).all()).toEqual([])
  })

  it('leaves a source with nothing to look up as it was: expanded in full, shared with the count and the preview', async () => {
    const source = filmSource()
    harness = build(source.adapter)

    const response = await fromSource('anything', 'Plain list', 'plain')

    expect(response.statusCode).toBe(201)
    expect(response.json().stats).toMatchObject({ totalItems: 2, runtimesPending: 0 })
    // Called as it always was, with the ref alone: no option for a source that has nothing to skip.
    expect(plainExpand).toHaveBeenCalledExactlyOnceWith('anything')
    expect((await readList(response.json().id)).items.map((item: { timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean }) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      [45, true],
      [30, false],
    ])
  })

  describe('opening and listing lists', () => {
    async function listWithEstimatedFilms() {
      const owner = await userId()
      const list = await createList(harness.db, owner, { title: 'Built earlier', mediaType: 'movie' })
      for (const n of [1, 2, 3]) {
        await createListItem(harness.db, owner, list.id, { title: `Film ${n}`, timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true, externalRef: `film:${n}` })
      }

      return list
    }

    it('shows how many lengths each list is still waiting for', async () => {
      harness = build(filmSource().adapter)
      const list = await listWithEstimatedFilms()

      const overview = (await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()

      expect(overview.find((entry: { id: string }) => entry.id === list.id).stats.runtimesPending).toBe(3)
    })

    it('opening a list with lengths still to look up starts the lookup, and says how many are waiting', async () => {
      const source = filmSource()
      harness = build(source.adapter)
      const list = await listWithEstimatedFilms()

      const release = source.hold()

      const opened = await readList(list.id)
      expect(opened.stats.runtimesPending).toBe(3)
      // Each row says whether its length is still coming, so the screen can show "-" and not the estimate.
      expect(opened.items.map((item: { runtimePending: boolean }) => item.runtimePending)).toEqual([true, true, true])

      // Nobody asked for the lookup but the opening: it begins by itself, and waits at the source.
      await vi.waitFor(() => expect(source.enrich).toHaveBeenCalled())
      release()
      await harness.app.runtimeFiller.fill(list.id)
      expect((await readList(list.id)).items.map((item: { runtimePending: boolean }) => item.runtimePending)).toEqual([false, false, false])
      expect(source.enrich.mock.calls.flat().flat().sort()).toEqual(['film:1', 'film:2', 'film:3'])
      expect(harness.db.select().from(listItems).where(eq(listItems.listId, list.id)).all().every((row) => !row.timeToConsumeIsEstimated)).toBe(true)
    })

    it('does not start anything for a list with nothing waiting', async () => {
      const source = filmSource()
      harness = build(source.adapter)
      const owner = await userId()
      const list = await createList(harness.db, owner, { title: 'Done', mediaType: 'movie' })
      await createListItem(harness.db, owner, list.id, { title: 'Real', timeToConsumeMinutes: 90, timeToConsumeIsEstimated: false, externalRef: 'film:1' })

      await readList(list.id)
      await harness.app.runtimeFiller.fill(list.id)

      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('does not ask a source that cannot answer, and shows nothing waiting', async () => {
      const source = filmSource()
      source.adapter.isAvailable = () => false
      harness = build(source.adapter)
      const list = await listWithEstimatedFilms()

      expect((await readList(list.id)).stats.runtimesPending).toBe(0)
      await harness.app.runtimeFiller.fill(list.id)
      expect(source.enrich).not.toHaveBeenCalled()
    })
  })

  describe('the per-result count and the Preview (15.8)', () => {
    const expansion = (key: string, ref: string, items = false) =>
      harness.app.inject({ method: 'GET', url: `/api/media-types/${key}/expansion?externalRef=${ref}${items ? '&items=true' : ''}` })

    it('counts a source by its listing alone, with no length looked up for it', async () => {
      const source = filmSource()
      harness = build(source.adapter)

      const response = await expansion('movie', 'first')

      expect(response.json()).toEqual({ itemCount: 3 })
      expect(source.expand).toHaveBeenCalledExactlyOnceWith('first', { runtimes: 'skip' })
      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('previews the items without lengths: the lookup is the build’s business, not the preview’s', async () => {
      const source = filmSource()
      harness = build(source.adapter)

      const { items } = (await expansion('movie', 'first', true)).json()

      expect(items.map((item: MediaTypeCandidate) => [item.title, item.timeToConsumeMinutes])).toEqual([
        ['Film 1', undefined],
        ['Film 2', undefined],
        ['Film 3', undefined],
      ])
      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('shares one listing between the count, the Preview and Add list', async () => {
      const source = filmSource()
      harness = build(source.adapter)

      await expansion('movie', 'first')
      await expansion('movie', 'first', true)
      const added = await fromSource('first')

      expect(added.json().stats.totalItems).toBe(3)
      expect(source.expand).toHaveBeenCalledTimes(1)
      await harness.app.runtimeFiller.fill(added.json().id)
    })

    it('leaves a source with nothing to look up as it was: expanded in full, called with the ref alone', async () => {
      harness = build(filmSource().adapter)

      const { items } = (await expansion('plain', 'anything', true)).json()

      expect(plainExpand).toHaveBeenCalledExactlyOnceWith('anything')
      expect(items.map((item: MediaTypeCandidate) => item.timeToConsumeMinutes)).toEqual([undefined, 30])
    })
  })

  describe('the runner as the app has it', () => {
    it('picks up lists that were left unfinished when asked to, as the server does at start', async () => {
      const source = filmSource()
      harness = build(source.adapter)
      const owner = await userId()
      const list = await createList(harness.db, owner, { title: 'Left unfinished', mediaType: 'movie' })
      for (const n of [1, 2]) {
        await createListItem(harness.db, owner, list.id, { title: `Film ${n}`, timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true, externalRef: `film:${n}` })
      }

      expect(await harness.app.runtimeFiller.fillAll()).toEqual({ lists: 1 })
      expect((await readList(list.id)).stats.runtimesPending).toBe(0)
    })

    it('stops when the app closes', async () => {
      const source = filmSource()
      const release = source.hold()
      harness = build(source.adapter)

      const response = await fromSource('many')
      const running = harness.app.runtimeFiller.fill(response.json().id)
      await harness.app.close()
      release()

      expect((await running).outcome).toBe('aborted')
    })
  })
})
