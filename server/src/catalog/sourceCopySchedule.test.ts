import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lists, users, type List } from '../db/schema.js'
import { createMediaTypeRegistry, type ListExpansion, type MediaTypeRegistry } from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, findList, findListSnapshot } from './repository.js'
import { dropSourceCopy } from './sourceCopy.js'
import {
  maintainSourceCopies,
  refreshAfterDays,
  startSourceCopySchedule,
} from './sourceCopySchedule.js'
import { eq } from 'drizzle-orm'

/**
 * Task 12.4: which source copies are looked after, and when. The fake clock is
 * the `now` passed in; no test waits for a real day.
 */
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-30T12:00:00.000Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)

describe('refreshAfterDays', () => {
  it('is 25 of YouTube’s 30 days and 150 of TMDB’s 180', () => {
    expect(refreshAfterDays(30)).toBe(25)
    expect(refreshAfterDays(180)).toBe(150)
  })
})

describe('maintainSourceCopies', () => {
  let harness: TestApp
  let registry: MediaTypeRegistry
  let userId: string
  const failing = new Set<string>()
  let inFlight = 0
  let mostAtOnce = 0
  const asked: string[] = []
  /** How many times each source has been read, so a title says which read a copy came from. */
  const reads = new Map<string, number>()

  beforeEach(async () => {
    failing.clear()
    reads.clear()
    asked.length = 0
    inFlight = 0
    mostAtOnce = 0

    const expand = vi.fn(async (ref: string): Promise<ListExpansion> => {
      asked.push(ref)
      inFlight += 1
      mostAtOnce = Math.max(mostAtOnce, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      if (failing.has(ref)) throw new Error(`offline: ${ref}`)
      reads.set(ref, (reads.get(ref) ?? 0) + 1)
      return { items: [{ title: `${ref} v${reads.get(ref)}`, externalRef: `${ref}-item` }] }
    })
    const adapter = { isAvailable: () => true, search: async () => [], expand }
    registry = createMediaTypeRegistry([
      { key: 'youtube', label: 'YouTube', sortOrder: 10, defaultDurationMinutes: 20, adapter, sourceCopyMaxDays: 30 },
      { key: 'movie', label: 'Movies', sortOrder: 20, defaultDurationMinutes: 120, adapter, sourceCopyMaxDays: 180 },
      { key: 'game', label: 'Games', sortOrder: 30, defaultDurationMinutes: 600, adapter },
    ])
    harness = createTestApp({ mediaTypes: registry })
    await harness.app.inject({ method: 'GET', url: '/api/lists' })
    userId = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const deps = () => ({ mediaTypes: registry.list() })

  /** A list fetched through the real import route, its copy dated `ageDays` before NOW. */
  async function fetched(mediaType: string, ref: string, ageDays: number): Promise<List> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType, externalRef: ref, title: ref },
    })
    expect(response.statusCode).toBe(201)
    await harness.db.update(lists).set({ snapshotFetchedAt: daysAgo(ageDays) }).where(eq(lists.id, response.json().id)).run()
    asked.length = 0 // the import asked its own question
    return (await findList(harness.db, userId, response.json().id))!
  }

  const titlesOf = async (list: List) =>
    (await findListSnapshot(harness.db, userId, list.id)).map((row) => row.title)

  it('refreshes a copy on its 25th day and leaves a younger one alone (YouTube, limit 30)', async () => {
    const due = await fetched('youtube', 'due', 25)
    const notYet = await fetched('youtube', 'not-yet', 24.9)

    const summary = await maintainSourceCopies(harness.db, deps(), NOW)

    expect(asked).toEqual(['due'])
    expect(await titlesOf(due)).toEqual(['due v2'])
    expect(await titlesOf(notYet)).toEqual(['not-yet v1'])
    expect((await findList(harness.db, userId, due.id))!.snapshotFetchedAt).toEqual(NOW)
    expect((await findList(harness.db, userId, notYet.id))!.snapshotFetchedAt).toEqual(daysAgo(24.9))
    expect(summary).toMatchObject({ refreshed: 1 })
  })

  it('does the same on the 150th day for a TMDB category (limit 180)', async () => {
    await fetched('movie', 'due', 150)
    await fetched('movie', 'not-yet', 149)

    await maintainSourceCopies(harness.db, deps(), NOW)

    expect(asked).toEqual(['due'])
  })

  it('asks nothing of the source for lists it has no business with', async () => {
    await fetched('game', 'no-limit', 400)
    const byHand = await createList(harness.db, userId, { title: 'By hand', mediaType: 'youtube' })
    await createList(harness.db, userId, {
      title: 'Curated',
      mediaType: 'youtube',
      source: 'canonical',
      externalRef: 'canonical:youtube/x.yaml',
    })

    const summary = await maintainSourceCopies(harness.db, deps(), NOW)

    expect(asked).toEqual([])
    expect(summary).toEqual({ checked: 0, refreshed: 0, created: 0, kept: 0, dropped: 0, missing: 0, failed: 0 })
    expect((await findList(harness.db, userId, byHand.id))!.snapshotFetchedAt).toBeNull()
  })

  it('gives a list whose copy was dropped a new one, however recently it was dropped', async () => {
    const list = await fetched('youtube', 'dropped', 1)
    await dropSourceCopy(harness.db, list)

    const summary = await maintainSourceCopies(harness.db, deps(), NOW)

    expect(asked).toEqual(['dropped'])
    expect(await titlesOf(list)).toEqual(['dropped v2'])
    expect(summary).toMatchObject({ created: 1 })
  })

  it('drops an overdue copy that cannot be refreshed, and keeps one that is due but still in time', async () => {
    const overdue = await fetched('youtube', 'overdue', 31)
    const inTime = await fetched('youtube', 'in-time', 27)
    failing.add('overdue').add('in-time')

    const summary = await maintainSourceCopies(harness.db, deps(), NOW)

    expect(await titlesOf(overdue)).toEqual([])
    expect((await findList(harness.db, userId, overdue.id))!.snapshotFetchedAt).toBeNull()
    expect(await titlesOf(inTime)).toEqual(['in-time v1'])
    expect((await findList(harness.db, userId, inTime.id))!.snapshotFetchedAt).toEqual(daysAgo(27))
    expect(summary).toMatchObject({ dropped: 1, kept: 1 })
  })

  it('does not let one failure stop the rest', async () => {
    const first = await fetched('youtube', 'first', 28)
    const broken = await fetched('youtube', 'broken', 29)
    const last = await fetched('movie', 'last', 160)
    failing.add('broken')

    const summary = await maintainSourceCopies(harness.db, deps(), NOW)

    expect(asked).toHaveLength(3)
    expect(await titlesOf(first)).toEqual(['first v2'])
    expect(await titlesOf(last)).toEqual(['last v2'])
    expect((await findList(harness.db, userId, broken.id))!.snapshotFetchedAt).toEqual(daysAgo(29))
    expect(summary).toEqual({ checked: 3, refreshed: 2, created: 0, kept: 1, dropped: 0, missing: 0, failed: 0 })
  })

  it('does not let a failure of its own kind (a write that fails) stop the rest either', async () => {
    const overdue = await fetched('youtube', 'overdue', 31)
    const other = await fetched('youtube', 'other', 26)
    failing.add('overdue')
    const db = harness.db
    let deletes = 0
    const brokenDrops = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property !== 'delete') return typeof value === 'function' ? value.bind(target) : value
        // Only the first write that removes anything fails: the overdue list's drop.
        return (table: Parameters<typeof target.delete>[0]) => {
          deletes += 1
          if (deletes === 1) throw new Error('disk full')
          return target.delete(table)
        }
      },
    })
    const reported: unknown[] = []

    const summary = await maintainSourceCopies(brokenDrops, deps(), NOW, (list, result) => {
      if (result.outcome === 'failed') reported.push([list.id, (result.error as Error).message])
    })

    // The overdue list goes first (oldest copy), and its failed drop is reported, not thrown.
    expect(reported).toEqual([[overdue.id, 'disk full']])
    expect(summary).toMatchObject({ failed: 1 })
    expect(asked).toEqual(['overdue', 'other'])
    // The failed drop did not stop the next list being refreshed.
    expect(await titlesOf(other)).toEqual(['other v2'])
  })

  it('goes one list at a time, oldest copy first, so each source’s own pacing holds', async () => {
    await fetched('youtube', 'b', 27)
    await fetched('youtube', 'a', 29)
    await fetched('movie', 'c', 170)
    await fetched('youtube', 'd', 26)

    await maintainSourceCopies(harness.db, deps(), NOW)

    expect(mostAtOnce).toBe(1)
    expect(asked).toEqual(['c', 'a', 'b', 'd'])
  })

  it('reports each list’s outcome as it goes', async () => {
    const list = await fetched('youtube', 'due', 26)
    const seen: [string, string][] = []

    await maintainSourceCopies(harness.db, deps(), NOW, (reported, result) => {
      seen.push([reported.id, result.outcome])
    })

    expect(seen).toEqual([[list.id, 'refreshed']])
  })
})

describe('startSourceCopySchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs as soon as it starts and then once a day', async () => {
    const run = vi.fn(async () => {})

    const stop = startSourceCopySchedule(run)
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(DAY - 1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(DAY)
    expect(run).toHaveBeenCalledTimes(3)
    stop()
  })

  it('does not start a run while the last one is still going', async () => {
    let finish!: () => void
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))

    const stop = startSourceCopySchedule(run)
    await vi.advanceTimersByTimeAsync(DAY * 3)
    expect(run).toHaveBeenCalledTimes(1)

    finish()
    await vi.advanceTimersByTimeAsync(DAY)
    expect(run).toHaveBeenCalledTimes(2)
    stop()
  })

  it('reports a run that throws and carries on the next day', async () => {
    const onError = vi.fn()
    const run = vi.fn(async () => {
      throw new Error('database locked')
    })

    const stop = startSourceCopySchedule(run, { onError })
    await vi.advanceTimersByTimeAsync(DAY)

    expect(run).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'database locked' }))
    stop()
  })

  it('stops when told to', async () => {
    const run = vi.fn(async () => {})

    const stop = startSourceCopySchedule(run)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    await vi.advanceTimersByTimeAsync(DAY * 5)

    expect(run).toHaveBeenCalledTimes(1)
  })
})
