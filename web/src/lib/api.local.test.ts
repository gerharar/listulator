import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMediaTypeRegistry,
  type ExpandOptions,
  type MediaType,
  type MediaTypeCandidate,
  type RuntimeLookup,
  type SearchAdapter,
} from '../../../server/src/ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../../../server/src/testing/harness.js'

/**
 * Task 15.6: the desktop builds a list at once from a listing and fills its lengths afterwards, the same as
 * the server does (15.5). The SQL plugin is replaced by a real in-memory SQLite (the real migrations run),
 * and the registry by a fake source that can skip and later look lengths up.
 */

let sqlite: BetterSqlite3.Database
const positional = (sql: string) => sql.replace(/\$\d+/g, '?')

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => ({
      execute: async (sql: string, params: unknown[] = []) => void sqlite.prepare(positional(sql)).run(...params),
      select: async (sql: string, params: unknown[] = []) => sqlite.prepare(positional(sql)).all(...params),
    })),
  },
}))

const registryHolder = vi.hoisted(() => ({ current: [] as readonly MediaType[] }))
vi.mock('./ingestion/localMediaTypes.js', () => ({
  getLocalMediaTypes: async () => registryHolder.current,
  resetLocalMediaTypes: () => undefined,
  LOCAL_FETCHERS: {},
}))

const DEFAULT_MINUTES = 120

/** Films `film:N`: 1 to 3 under `first`, 2 to 4 under `second`, in two seasons so grouping is exercised. */
function filmSource(options: { available?: boolean; answer?: (ref: string) => RuntimeLookup } = {}) {
  let gate: Promise<void> | undefined
  const hold = (): (() => void) => {
    let release!: () => void
    gate = new Promise<void>((resolve) => (release = resolve))

    return release
  }
  /** A source can change after a list was built from it: `grow('first', [1, 2, 3, 4])`. */
  const overrides = new Map<string, number[]>()
  const grow = (ref: string, numbers: number[]) => void overrides.set(ref, numbers)
  const expand = vi.fn(async (ref: string, expandOptions?: ExpandOptions) => ({
    items: (overrides.get(ref) ?? (ref === 'huge' ? Array.from({ length: 10_001 }, (_, index) => index + 1) : ref === 'first' ? [1, 2, 3] : [2, 3, 4])).map(
      (n): MediaTypeCandidate => ({
        title: `Film ${n}`,
        externalRef: `film:${n}`,
        year: 2000 + n,
        group: n % 2 === 0 ? 'Even' : 'Odd',
        ...(expandOptions?.runtimes === 'skip' ? {} : { timeToConsumeMinutes: 100 + n }),
      }),
    ),
  }))
  const enrich = vi.fn(async (refs: string[]) => {
    await gate

    return new Map(refs.map((ref): [string, RuntimeLookup] => [ref, options.answer?.(ref) ?? { status: 'found', minutes: 100 + Number(ref.split(':')[1]) }]))
  })
  const adapter: SearchAdapter = {
    isAvailable: () => options.available ?? true,
    search: async () => [],
    expand,
    enrich,
    enrichPrefixes: ['film'],
  }

  return { adapter, expand, enrich, hold, grow }
}

const movieType = (adapter: SearchAdapter): MediaType => ({
  key: 'movie',
  label: 'Movies',
  sortOrder: 10,
  defaultDurationMinutes: DEFAULT_MINUTES,
  sourceName: 'Fake',
  sourceCopyMaxDays: 180,
  adapter,
})

async function freshModules() {
  vi.resetModules()
  const [local, db, user, repository] = await Promise.all([
    import('./api.local.js'),
    import('./db/localDb.js'),
    import('./db/localUser.js'),
    import('../../../server/src/catalog/repository.js'),
  ])

  return { local, db, user, repository }
}

describe('the desktop builds a list at once and fills its lengths afterwards (15.6)', () => {
  beforeEach(() => {
    sqlite = new BetterSqlite3(':memory:')
  })

  afterEach(() => {
    sqlite.close()
    registryHolder.current = []
  })

  async function start(source: ReturnType<typeof filmSource>) {
    registryHolder.current = [movieType(source.adapter)]
    const modules = await freshModules()
    const api = modules.local.createLocalApi()
    const filler = await modules.local.getLocalRuntimeFiller()

    return { ...modules, api, filler }
  }

  const summary = (items: { title: string; group: string | null; orderIndex: number; timeToConsumeMinutes: number; timeToConsumeIsEstimated: boolean; runtimePending?: boolean }[]) =>
    items.map((item) => [item.title, item.group, item.orderIndex, item.timeToConsumeMinutes, item.timeToConsumeIsEstimated, item.runtimePending])

  it('lists the source without lengths, makes the list at once with the estimate, and says how many are waiting', async () => {
    const source = filmSource()
    const release = source.hold()
    const { api, filler } = await start(source)

    const list = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'First' })

    expect(source.expand).toHaveBeenCalledExactlyOnceWith('first', { runtimes: 'skip' })
    expect(list.stats).toMatchObject({ totalItems: 3, runtimesPending: 3 })
    expect((await api.list(list.id)).items.map((item) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      [DEFAULT_MINUTES, true],
      [DEFAULT_MINUTES, true],
      [DEFAULT_MINUTES, true],
    ])

    release()
    await filler.fill(list.id)

    const after = await api.list(list.id)
    expect(after.items.map((item) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([
      [101, false],
      [103, false],
      [102, false],
    ])
    expect(after.stats.runtimesPending).toBe(0)
  })

  it('starts the lookup after the reply and does not wait for it', async () => {
    const source = filmSource()
    const release = source.hold()
    const { api, filler } = await start(source)

    const list = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'First' })

    await vi.waitFor(() => expect(source.enrich).toHaveBeenCalled())
    release()
    await filler.fill(list.id)
  })

  it('gives a second list the lengths the first already looked up, in the reply itself', async () => {
    const source = filmSource()
    const { api, filler } = await start(source)
    const first = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'First' })
    await filler.fill(first.id)
    const release = source.hold()

    const second = await api.createFromSource({ mediaType: 'movie', externalRef: 'second', title: 'Second' })

    // Films 2 and 3 are known, film 4 is the estimate: said by the reply itself, before any lookup ran.
    expect(second.stats).toMatchObject({ runtimesPending: 1, timeRemainingMinutes: 102 + 103 + DEFAULT_MINUTES })
    release()
    await filler.fill(second.id)
  })

  it('keeps a lookup that failed pending, and the build still succeeds', async () => {
    const source = filmSource({ answer: (ref) => (ref === 'film:2' ? { status: 'failed', error: new Error('down') } : { status: 'found', minutes: 90 }) })
    const { api, filler } = await start(source)

    const list = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'First' })
    await filler.fill(list.id)

    expect((await api.list(list.id)).stats.runtimesPending).toBe(1)
  })

  it('leaves a source with nothing to look up as it was', async () => {
    const expand = vi.fn<(ref: string) => Promise<{ items: MediaTypeCandidate[] }>>(async () => ({
      items: [{ title: 'A' }, { title: 'B', timeToConsumeMinutes: 30 }],
    }))
    registryHolder.current = [{ key: 'plain', label: 'Plain', sortOrder: 1, defaultDurationMinutes: 45, adapter: { isAvailable: () => true, search: async () => [], expand } }]
    const { local } = await freshModules()
    const api = local.createLocalApi()

    const list = await api.createFromSource({ mediaType: 'plain', externalRef: 'anything', title: 'Plain list' })

    expect(expand).toHaveBeenCalledExactlyOnceWith('anything')
    expect(list.stats).toMatchObject({ totalItems: 2, runtimesPending: 0 })
  })

  describe('the per-result count and the Preview (15.8)', () => {
    it('counts a source by its listing alone, and previews its items without lengths', async () => {
      const source = filmSource()
      const { api } = await start(source)

      const counted = await api.expansion('movie', 'first')
      const previewed = await api.preview('movie', 'first')

      expect(counted).toEqual({ itemCount: 3 })
      expect(previewed.items.map((item) => [item.title, item.timeToConsumeMinutes])).toEqual([
        ['Film 1', undefined],
        ['Film 2', undefined],
        ['Film 3', undefined],
      ])
      expect(source.expand).toHaveBeenCalledExactlyOnceWith('first', { runtimes: 'skip' })
      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('shares one listing between the count, the Preview and Add list', async () => {
      const source = filmSource()
      const { api, filler } = await start(source)

      await api.expansion('movie', 'first')
      await api.preview('movie', 'first')
      const added = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'First' })

      expect(added.stats.totalItems).toBe(3)
      expect(source.expand).toHaveBeenCalledTimes(1)
      await filler.fill(added.id)
    })
  })

  describe('the ceiling on a list: ten thousand items (15.9)', () => {
    it('fails the count and the Preview of a source above it, and refuses to build it, with the API’s own error', async () => {
      const { api } = await start(filmSource())

      await expect(api.expansion('movie', 'huge')).rejects.toMatchObject({ code: 'list.sourceTooLarge', status: 422 })
      await expect(api.preview('movie', 'huge')).rejects.toMatchObject({ code: 'list.sourceTooLarge' })
      await expect(api.createFromSource({ mediaType: 'movie', externalRef: 'huge', title: 'Everything TMDB has' })).rejects.toMatchObject({
        code: 'list.sourceTooLarge',
        message: expect.stringContaining('Everything TMDB has'),
      })
      expect(await api.lists()).toEqual([])
    })
  })

  describe('Check for updates and Update List without the cost (15.10)', () => {
    async function builtList(source: ReturnType<typeof filmSource>, ref = 'first', title = 'First') {
      const started = await start(source)
      const list = await started.api.createFromSource({ mediaType: 'movie', externalRef: ref, title })
      await started.filler.fill(list.id)
      source.expand.mockClear()
      source.enrich.mockClear()

      return { ...started, list }
    }

    it('lists the source without lengths, finds what is new, and looks nothing up to do it', async () => {
      const source = filmSource()
      const { api, list } = await builtList(source)
      source.grow('first', [1, 2, 3, 4])

      const found = await api.checkForUpdates(list.id)

      expect(found).toMatchObject({ upstreamCount: 4, existingCount: 3 })
      expect(found.newItems.map((item) => [item.title, item.timeToConsumeMinutes])).toEqual([['Film 4', undefined]])
      expect(source.expand).toHaveBeenCalledExactlyOnceWith('first', { runtimes: 'skip' })
      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('adds a new film with the length another list already looked up, and nothing is left to look up', async () => {
      const source = filmSource()
      const { api, filler, list } = await builtList(source)
      const other = await api.createFromSource({ mediaType: 'movie', externalRef: 'second', title: 'Second' })
      await filler.fill(other.id)
      source.enrich.mockClear()
      source.grow('first', [1, 2, 3, 4])

      const created = await api.importItems(list.id, (await api.checkForUpdates(list.id)).newItems, 'import', true)

      expect(created.map((item) => [item.title, item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([['Film 4', 104, false]])
      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('adds a film nobody has looked up with the estimate, and the runner fills it in afterwards', async () => {
      const source = filmSource()
      const { api, filler, list } = await builtList(source)
      source.grow('first', [1, 2, 3, 5])
      const release = source.hold()

      const created = await api.importItems(list.id, (await api.checkForUpdates(list.id)).newItems, 'import', true)

      expect(created.map((item) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([[DEFAULT_MINUTES, true]])
      await vi.waitFor(() => expect(source.enrich).toHaveBeenCalledExactlyOnceWith(['film:5']))
      release()
      await filler.fill(list.id)

      expect((await api.list(list.id)).items.find((item) => item.title === 'Film 5')).toMatchObject({ timeToConsumeMinutes: 105, timeToConsumeIsEstimated: false })
    })

    it('refuses a source that has grown past the ceiling, naming the list and the count', async () => {
      const source = filmSource()
      const { api, list } = await builtList(source)
      source.grow('first', Array.from({ length: 10_001 }, (_, index) => index + 1))

      await expect(api.checkForUpdates(list.id)).rejects.toMatchObject({
        code: 'list.sourceTooLarge',
        message: expect.stringContaining('First'),
      })
    })
  })

  describe('Reset without the cost (15.11)', () => {
    /** A fetched list whose stored copy was taken before any length was looked up: all three are estimates. */
    async function staleCopy(source: ReturnType<typeof filmSource>) {
      const started = await start(source)
      const database = await started.db.createLocalDb()
      const owner = (await started.user.getLocalCurrentUser(database)).id
      const { repository } = started
      const list = await repository.createList(database, owner, { title: 'First', mediaType: 'movie', source: 'api', externalRef: 'first', arrivedTitle: 'First', arrivedDescription: null, arrivedStatus: null, snapshotFetchedAt: new Date() })
      const rows = [1, 2, 3].map((n) => ({ title: `Film ${n}`, externalRef: `film:${n}`, orderIndex: n - 1, timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true }))
      for (const row of rows) await repository.createListItem(database, owner, list.id, { title: row.title, externalRef: row.externalRef, timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true })
      await repository.createListSnapshot(database, list.id, rows)

      return { ...started, database, owner, list }
    }

    const lengths = async (api: Awaited<ReturnType<typeof start>>['api'], listId: string) =>
      (await api.list(listId)).items.filter((item) => ['Film 1', 'Film 2', 'Film 3'].includes(item.title)).map((item) => [item.title, item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])

    it('gives a film another list has looked up its length at once, and the runner fills the rest after', async () => {
      const source = filmSource()
      const { api, filler, list, database } = await staleCopy(source)
      const { recordRuntimes } = await import('../../../server/src/catalog/runtimes.js')
      await recordRuntimes(database, [{ ref: 'film:2', minutes: 102 }, { ref: 'film:3', minutes: 103 }], { now: new Date(), ttlDays: 150 })
      const release = source.hold()

      await api.resetList(list.id)

      // Started by the Reset itself, before anything has opened the list; waiting at the source.
      await vi.waitFor(() => expect(source.enrich).toHaveBeenCalledExactlyOnceWith(['film:1']))
      expect(await lengths(api, list.id)).toEqual([['Film 1', DEFAULT_MINUTES, true], ['Film 2', 102, false], ['Film 3', 103, false]])
      release()
      await filler.fill(list.id)
      expect((await lengths(api, list.id))[0]).toEqual(['Film 1', 101, false])
    })

    it('refuses to reset a list with no stored copy to a source that has grown past the ceiling, naming the list', async () => {
      const source = filmSource()
      const { api, list, database, owner, repository } = await staleCopy(source)
      const { dropSourceCopy } = await import('../../../server/src/catalog/sourceCopy.js')
      await dropSourceCopy(database, (await repository.findList(database, owner, list.id))!)
      source.grow('first', Array.from({ length: 10_001 }, (_, index) => index + 1))

      await expect(api.resetList(list.id)).rejects.toMatchObject({ code: 'list.sourceTooLarge', status: 422, message: expect.stringContaining('First') })
      await expect(api.resetPreview(list.id)).rejects.toMatchObject({ code: 'list.sourceTooLarge' })
    })
  })

  describe('which lists can be reset (Checkpoint C)', () => {
    it('says a file list imported before its file was kept cannot be reset, and one with its file can', async () => {
      const { api, db, user, repository } = await start(filmSource())
      const database = await db.createLocalDb()
      const owner = (await user.getLocalCurrentUser(database)).id
      const legacy = await repository.createList(database, owner, { title: 'Star Wars', mediaType: 'movie', source: 'file' })
      const kept = await repository.createList(database, owner, { title: 'Kept', mediaType: 'movie', source: 'file', sourceYaml: 'title: Kept' })
      const fetched = await repository.createList(database, owner, { title: 'Fetched', mediaType: 'movie', source: 'api', externalRef: 'first' })

      expect((await api.list(legacy.id)).canReset).toBe(false)
      expect(Object.fromEntries((await api.lists()).map((entry) => [entry.title, entry.canReset]))).toEqual({ 'Star Wars': false, Kept: true, Fetched: true })
      expect((await api.list(kept.id)).canReset).toBe(true)
      expect((await api.list(fetched.id)).canReset).toBe(true)
    })
  })

  describe('opening and listing lists', () => {
    async function builtEarlier(source: ReturnType<typeof filmSource>) {
      const started = await start(source)
      const database = await started.db.createLocalDb()
      const owner = (await started.user.getLocalCurrentUser(database)).id
      const list = await started.repository.createList(database, owner, { title: 'Built earlier', mediaType: 'movie' })
      for (const n of [1, 2, 3]) {
        await started.repository.createListItem(database, owner, list.id, { title: `Film ${n}`, timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true, externalRef: `film:${n}` })
      }

      return { ...started, list }
    }

    it('shows how many lengths each list is still waiting for', async () => {
      const { api, list } = await builtEarlier(filmSource())

      expect((await api.lists()).find((entry) => entry.id === list.id)?.stats.runtimesPending).toBe(3)
    })

    it('opening a list with lengths still to look up starts the lookup, and the answer shows what was waiting', async () => {
      const source = filmSource()
      const { api, list, filler } = await builtEarlier(source)
      const release = source.hold()

      const opened = await api.list(list.id)
      expect(opened.stats.runtimesPending).toBe(3)
      // Each row says whether its length is still coming, so the screen can show "-" and not the estimate (15.7).
      expect(opened.items.map((item) => item.runtimePending)).toEqual([true, true, true])

      await vi.waitFor(() => expect(source.enrich).toHaveBeenCalled())
      release()
      await filler.fill(list.id)
      expect((await api.list(list.id)).stats.runtimesPending).toBe(0)
      expect((await api.list(list.id)).items.map((item) => item.runtimePending)).toEqual([false, false, false])
    })

    it('does not start anything for a list with nothing waiting', async () => {
      const source = filmSource()
      const { api, list, filler, db, repository } = await builtEarlier(source)
      const database = await db.createLocalDb()
      const items = (await repository.findListItems(database, list.userId, list.id))!
      for (const item of items) await repository.updateListItem(database, list.userId, list.id, item.id, { timeToConsumeMinutes: 60, timeToConsumeIsEstimated: false })

      await api.list(list.id)
      await filler.fill(list.id)

      expect(source.enrich).not.toHaveBeenCalled()
    })

    it('follows the registry when a key is saved in Settings: nothing is asked while the source cannot answer, and the lookup starts once it can', async () => {
      const source = filmSource({ available: false })
      const { api, list, filler } = await builtEarlier(source)

      expect((await api.list(list.id)).stats.runtimesPending).toBe(0)
      await filler.fill(list.id)
      expect(source.enrich).not.toHaveBeenCalled()

      // The key is saved: Settings rebuilds the registry, with an adapter that can now answer.
      const keyed = filmSource()
      registryHolder.current = [movieType(keyed.adapter)]

      expect((await api.list(list.id)).stats.runtimesPending).toBe(3)
      await filler.fill(list.id)
      expect(keyed.enrich.mock.calls.flat().flat().sort()).toEqual(['film:1', 'film:2', 'film:3'])
    })
  })

  describe('at launch', () => {
    it('picks up the lists that were left unfinished when the app was last open', async () => {
      const source = filmSource()
      registryHolder.current = [movieType(source.adapter)]
      const { local, db, user, repository } = await freshModules()
      const database = await db.createLocalDb()
      const owner = (await user.getLocalCurrentUser(database)).id
      const list = await repository.createList(database, owner, { title: 'Left unfinished', mediaType: 'movie' })
      await repository.createListItem(database, owner, list.id, { title: 'Film 1', timeToConsumeMinutes: DEFAULT_MINUTES, timeToConsumeIsEstimated: true, externalRef: 'film:1' })

      await local.startLocalRuntimeFill()

      const items = (await repository.findListItems(database, owner, list.id))!
      expect(items.map((item) => [item.timeToConsumeMinutes, item.timeToConsumeIsEstimated])).toEqual([[101, false]])
    })

    it('can be started more than once without a second run', async () => {
      const source = filmSource()
      registryHolder.current = [movieType(source.adapter)]
      const { local } = await freshModules()

      await Promise.all([local.startLocalRuntimeFill(), local.startLocalRuntimeFill()])

      expect(await local.getLocalRuntimeFiller()).toBe(await local.getLocalRuntimeFiller())
    })
  })

  describe('the same source builds the same list on the desktop and on the server', () => {
    let server: TestApp

    afterEach(async () => {
      await server?.cleanup()
    })

    it('with the same items, groups, order and lengths, before and after the lengths are looked up', async () => {
      const desktopSource = filmSource()
      const serverSource = filmSource()
      const { api, filler } = await start(desktopSource)
      server = createTestApp({
        mediaTypes: createMediaTypeRegistry([movieType(serverSource.adapter)]),
        runtimeFill: { sleep: async () => undefined, limiterFor: () => undefined },
      })
      const hold = [desktopSource.hold(), serverSource.hold()]

      const onDesktop = await api.createFromSource({ mediaType: 'movie', externalRef: 'first', title: 'Same' })
      const onServer = (await server.app.inject({ method: 'POST', url: '/api/lists/from-source', payload: { mediaType: 'movie', externalRef: 'first', title: 'Same' } })).json()
      const read = async (listId: string) => (await server.app.inject({ method: 'GET', url: `/api/lists/${listId}` })).json()

      expect(summary((await api.list(onDesktop.id)).items)).toEqual(summary((await read(onServer.id)).items))
      expect(onDesktop.stats).toMatchObject({ totalItems: onServer.stats.totalItems, runtimesPending: onServer.stats.runtimesPending, timeRemainingMinutes: onServer.stats.timeRemainingMinutes })

      for (const release of hold) release()
      await filler.fill(onDesktop.id)
      await server.app.runtimeFiller.fill(onServer.id)

      expect(summary((await api.list(onDesktop.id)).items)).toEqual(summary((await read(onServer.id)).items))
      expect((await api.list(onDesktop.id)).groups.map((group) => [group.name, group.orderIndex])).toEqual((await read(onServer.id)).groups.map((group: { name: string; orderIndex: number }) => [group.name, group.orderIndex]))
    })
  })
})
