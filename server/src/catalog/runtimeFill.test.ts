import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { itemRuntimes, listItems, listSnapshots, users } from '../db/schema.js'
import { UpstreamError } from '../ingestion/http.js'
import type { MediaType, RuntimeLookup, SearchAdapter } from '../ingestion/mediaTypes.js'
import { createRateLimiter, type RateLimiter } from '../ingestion/rateLimiter.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import {
  createList,
  createListItem,
  createListSnapshot,
  deleteList,
  deleteListItem,
  findListItems,
  updateListItem,
} from './repository.js'
import { knownRuntimes, pendingFor, recordRuntimes } from './runtimes.js'
import { createRuntimeFiller, createSourceLimiters, type RuntimeFillDeps } from './runtimeFill.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-03T12:00:00Z')

type Answer = RuntimeLookup | 'throw'

/** A source that can enrich `movie:` refs, answering from a script and recording every call. */
function fakeSource(answer: (ref: string) => Answer = (ref) => ({ status: 'found', minutes: 100 + Number(ref.split(':')[1]) })) {
  const calls: string[][] = []
  let inFlight = 0
  let peak = 0
  let overlapped = false
  const hooks: { onCall?: (call: number, refs: string[]) => Promise<void> | void } = {}

  const adapter: SearchAdapter = {
    isAvailable: () => true,
    search: async () => [],
    expand: async () => ({ items: [] }),
    enrichPrefixes: ['movie'],
    enrich: async (refs) => {
      if (inFlight > 0) overlapped = true
      inFlight += 1
      peak = Math.max(peak, refs.length)
      calls.push([...refs])
      try {
        await hooks.onCall?.(calls.length, refs)
        const out = new Map<string, RuntimeLookup>()
        for (const ref of refs) {
          const result = answer(ref)
          if (result === 'throw') throw new Error('upstream down')
          out.set(ref, result)
        }

        return out
      } finally {
        inFlight -= 1
      }
    },
  }

  return { adapter, calls, hooks, peak: () => peak, overlapped: () => overlapped }
}

const movieType = (adapter: SearchAdapter | undefined, extra: Partial<MediaType> = {}): MediaType => ({
  key: 'movie',
  label: 'Movies',
  sortOrder: 1,
  defaultDurationMinutes: 120,
  sourceName: 'TMDB',
  sourceCopyMaxDays: 180,
  ...(adapter ? { adapter } : {}),
  ...extra,
})

describe('the runtime runner (15.4)', () => {
  let harness: TestApp
  let userId: string
  const sleeps: number[] = []

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    userId = harness.db.select().from(users).get()!.id
    sleeps.length = 0
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db

  function filler(source: ReturnType<typeof fakeSource> | undefined, deps: Partial<RuntimeFillDeps> = {}) {
    return createRuntimeFiller({
      db: db(),
      mediaTypes: [movieType(source?.adapter)],
      now: () => NOW,
      sleep: async (ms) => void sleeps.push(ms),
      ...deps,
    })
  }

  /** A list of `count` estimated films, refs movie:1..count, with its source copy. */
  async function listOfFilms(count: number, mediaType = 'movie') {
    const list = await createList(db(), userId, { title: 'L', mediaType })
    for (let index = 1; index <= count; index += 1) {
      await createListItem(db(), userId, list.id, {
        title: `Film ${index}`,
        timeToConsumeMinutes: 120,
        timeToConsumeIsEstimated: true,
        externalRef: `movie:${index}`,
      })
    }
    await createListSnapshot(db(), list.id, (await findListItems(db(), userId, list.id))!)

    return list
  }

  const items = async (listId: string) => (await findListItems(db(), userId, listId))!

  it('looks the lengths up eight at a time, in list order, and writes them to the items and the source copy', async () => {
    const source = fakeSource()
    const list = await listOfFilms(20)

    const result = await filler(source).fill(list.id)

    expect(result).toMatchObject({ outcome: 'done', filled: 20, none: 0, failed: 0, pending: 0 })
    expect(source.calls.map((refs) => refs.length)).toEqual([8, 8, 4])
    expect(source.calls.flat()).toEqual(Array.from({ length: 20 }, (_, index) => `movie:${index + 1}`))

    const filled = await items(list.id)
    expect(filled[0]).toMatchObject({ timeToConsumeMinutes: 101, timeToConsumeIsEstimated: false })
    expect(filled.every((item) => item.timeToConsumeIsEstimated === false)).toBe(true)
    expect(db().select().from(listSnapshots).all().every((row) => row.timeToConsumeIsEstimated === false)).toBe(true)
  })

  it('remembers each answer for the source’s copy limit less the refresh margin: 150 of 180 days', async () => {
    const list = await listOfFilms(1)

    await filler(fakeSource()).fill(list.id)

    const row = db().select().from(itemRuntimes).get()!
    expect(row.expiresAt.getTime() - row.fetchedAt.getTime()).toBe(150 * DAY)
  })

  it('never has more than eight in flight, and never two lookups at once for one list', async () => {
    const source = fakeSource()

    await filler(source).fill((await listOfFilms(30)).id)

    expect(source.peak()).toBeLessThanOrEqual(8)
    expect(source.overlapped()).toBe(false)
  })

  describe('what an answer means', () => {
    it('records "the source has none" as a known answer: the item keeps its estimate and is not asked again', async () => {
      const source = fakeSource(() => ({ status: 'none' }))
      const list = await listOfFilms(3)

      const first = await filler(source).fill(list.id)
      const second = await filler(source).fill(list.id)

      expect(first).toMatchObject({ outcome: 'done', filled: 0, none: 3, failed: 0, pending: 0 })
      expect(second.outcome).toBe('done')
      expect(source.calls).toHaveLength(1)
      expect((await items(list.id))[0]).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
      expect((await knownRuntimes(db(), ['movie:1'], NOW)).get('movie:1')).toBeNull()
    })

    it('leaves a failed lookup pending and records nothing for it, not even a null', async () => {
      const source = fakeSource((ref) => (ref === 'movie:2' ? { status: 'failed', error: new Error('down') } : { status: 'found', minutes: 90 }))
      const list = await listOfFilms(3)

      const result = await filler(source).fill(list.id)

      expect(result).toMatchObject({ outcome: 'done', filled: 2, failed: 1, pending: 1 })
      expect((await knownRuntimes(db(), ['movie:1', 'movie:2', 'movie:3'], NOW)).has('movie:2')).toBe(false)
      expect(await pendingFor(db(), list.id, NOW, ['movie'])).toEqual(['movie:2'])
      expect((await items(list.id))[1]).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('treats a lookup call that throws as every ref in it failed, and does not throw itself', async () => {
      const list = await listOfFilms(3)

      const result = await filler(fakeSource(() => 'throw')).fill(list.id)

      expect(result).toMatchObject({ filled: 0, failed: 3, pending: 3 })
      expect(db().select().from(itemRuntimes).all()).toEqual([])
    })
  })

  describe('resuming', () => {
    it('picks up from the database alone: a new runner asks only for what is still pending', async () => {
      const list = await listOfFilms(10)
      let allowed = 4
      const first = fakeSource(() => (allowed-- > 0 ? { status: 'found', minutes: 90 } : { status: 'failed', error: new Error('cut off') }))
      await filler(first).fill(list.id)

      const second = fakeSource()
      const result = await filler(second).fill(list.id)

      expect(second.calls.flat()).toEqual(Array.from({ length: 6 }, (_, index) => `movie:${index + 5}`))
      expect(result).toMatchObject({ outcome: 'done', pending: 0 })
    })

    it('gives a list the lengths another list already looked up, without asking again', async () => {
      const list = await listOfFilms(3)
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 77 }, { ref: 'movie:2', minutes: null }], { now: NOW, ttlDays: 150 })
      const source = fakeSource()

      await filler(source).fill(list.id)

      expect(source.calls.flat()).toEqual(['movie:3'])
      expect((await items(list.id))[0]).toMatchObject({ timeToConsumeMinutes: 77, timeToConsumeIsEstimated: false })
      expect((await items(list.id))[1]).toMatchObject({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('asks again for an answer that has lapsed, and clears the lapsed rows first', async () => {
      const list = await listOfFilms(1)
      await recordRuntimes(db(), [{ ref: 'movie:1', minutes: 50 }, { ref: 'movie:99', minutes: 60 }], { now: new Date(NOW.getTime() - 200 * DAY), ttlDays: 150 })
      const source = fakeSource()

      await filler(source).fill(list.id)

      expect(source.calls.flat()).toEqual(['movie:1'])
      expect((await items(list.id))[0]?.timeToConsumeMinutes).toBe(101)
      expect((await knownRuntimes(db(), ['movie:99'], new Date(NOW.getTime() - 100 * DAY))).size).toBe(0)
    })
  })

  describe('while it runs', () => {
    it('stops quietly when the list is deleted underneath it', async () => {
      const source = fakeSource()
      const list = await listOfFilms(20)
      source.hooks.onCall = async (call) => {
        if (call === 1) await deleteList(db(), userId, list.id)
      }

      const result = await filler(source).fill(list.id)

      expect(result.outcome).toBe('list-gone')
      expect(source.calls).toHaveLength(1)
    })

    it('copes with an item deleted underneath it', async () => {
      const source = fakeSource()
      const list = await listOfFilms(10)
      const victim = (await items(list.id))[2]!
      source.hooks.onCall = async (call) => {
        if (call === 1) await deleteListItem(db(), userId, list.id, victim.id)
      }

      const result = await filler(source).fill(list.id)

      expect(result.outcome).toBe('done')
      expect((await items(list.id)).every((item) => item.timeToConsumeIsEstimated === false)).toBe(true)
    })

    it('does not overwrite a time the user sets while it is running', async () => {
      const source = fakeSource()
      const list = await listOfFilms(3)
      const mine = (await items(list.id))[0]!
      source.hooks.onCall = async () => {
        await updateListItem(db(), userId, list.id, mine.id, { timeToConsumeMinutes: 55, timeToConsumeIsEstimated: false })
      }

      await filler(source).fill(list.id)

      expect((await items(list.id))[0]).toMatchObject({ timeToConsumeMinutes: 55, timeToConsumeIsEstimated: false })
      expect(db().select().from(listItems).all().find((item) => item.id === mine.id)?.timeToConsumeMinutes).toBe(55)
    })

    it('stops when asked to, after the batch in hand, leaving the rest pending', async () => {
      const source = fakeSource()
      const list = await listOfFilms(20)
      const controller = new AbortController()
      source.hooks.onCall = (call) => {
        if (call === 1) controller.abort()
      }

      const result = await filler(source, { signal: controller.signal }).fill(list.id)

      expect(result).toMatchObject({ outcome: 'aborted', filled: 8, pending: 12 })
      expect(source.calls).toHaveLength(1)
    })

    it('stops at once when asked to while it is backing off, not after the wait', async () => {
      const source = fakeSource(() => ({ status: 'failed', error: new Error('down') }))
      const list = await listOfFilms(20)
      const controller = new AbortController()

      const result = await filler(source, {
        signal: controller.signal,
        // A wait that never ends by itself: only the abort can end this run.
        sleep: () => {
          queueMicrotask(() => controller.abort())

          return new Promise(() => undefined)
        },
      }).fill(list.id)

      expect(result.outcome).toBe('aborted')
    })
  })

  describe('a source that is not answering', () => {
    it('waits longer after each batch that got nothing, and gives up after three in a row', async () => {
      const source = fakeSource(() => ({ status: 'failed', error: new Error('down') }))
      const list = await listOfFilms(40)

      const result = await filler(source).fill(list.id)

      expect(result).toMatchObject({ outcome: 'upstream-unavailable', filled: 0, failed: 24, pending: 40 })
      expect(source.calls).toHaveLength(3)
      expect(sleeps).toHaveLength(2)
      expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!)
    })

    it('waits as long as a rate-limited source asks to, when it says', async () => {
      const source = fakeSource(() => ({ status: 'failed', error: new UpstreamError('TMDB is rate-limiting us.', 429, 7000) }))

      await filler(source).fill((await listOfFilms(40)).id)

      expect(sleeps[0]).toBe(7000)
    })

    it('carries on after one bad batch when the next gets through, without giving up', async () => {
      let call = 0
      const source = fakeSource(() => (call++ < 8 ? { status: 'failed', error: new Error('blip') } : { status: 'found', minutes: 90 }))
      const list = await listOfFilms(24)

      const result = await filler(source).fill(list.id)

      expect(result).toMatchObject({ outcome: 'done', filled: 16, failed: 8, pending: 8 })
    })
  })

  describe('one runner per list', () => {
    it('gives a second request for a list already being filled the same run', async () => {
      const source = fakeSource()
      const list = await listOfFilms(20)
      const runner = filler(source)

      const [a, b] = await Promise.all([runner.fill(list.id), runner.fill(list.id)])

      expect(a).toBe(b)
      expect(source.calls.flat()).toHaveLength(20)
    })

    it('runs again for the same list once the first run is over', async () => {
      const source = fakeSource((ref) => (ref === 'movie:1' ? { status: 'failed', error: new Error('x') } : { status: 'found', minutes: 90 }))
      const list = await listOfFilms(2)
      const runner = filler(source)

      await runner.fill(list.id)
      await runner.fill(list.id)

      expect(source.calls.flat().filter((ref) => ref === 'movie:1')).toHaveLength(2)
    })

    it('passes every batch through the source’s limiter', async () => {
      let runs = 0
      const limiter: RateLimiter = { run: (fn) => (runs++, fn()) }
      const source = fakeSource()

      await filler(source, { limiterFor: () => limiter }).fill((await listOfFilms(20)).id)

      expect(runs).toBe(3)
    })

    it('shares one limiter per source name, so two categories on one source take turns', () => {
      const limiters = createSourceLimiters(200)

      expect(limiters('TMDB')).toBe(limiters('TMDB'))
      expect(limiters('TMDB')).not.toBe(limiters('IGDB'))
      expect(createSourceLimiters(200)('TMDB')).not.toBe(limiters('TMDB'))
    })

    it('really spaces batches by the interval when the limiter is the shared kind', async () => {
      let clock = 0
      const waits: number[] = []
      const limiter = createRateLimiter(200, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms } })
      const source = fakeSource()

      await filler(source, { limiterFor: () => limiter }).fill((await listOfFilms(24)).id)

      expect(waits).toEqual([200, 200])
    })
  })

  describe('what it will not do', () => {
    it('does nothing for a category whose source cannot look lengths up, or that has no source', async () => {
      const list = await listOfFilms(2, 'game')
      const noEnrich: SearchAdapter = { isAvailable: () => true, search: async () => [], expand: async () => ({ items: [] }) }

      for (const adapter of [undefined, noEnrich]) {
        const runner = createRuntimeFiller({ db: db(), mediaTypes: [movieType(adapter, { key: 'game' })], now: () => NOW, sleep: async () => undefined })

        expect(await runner.fill(list.id)).toMatchObject({ outcome: 'unsupported', filled: 0 })
      }
    })

    it('does nothing for a list that is not there, or a category it has never heard of', async () => {
      const runner = filler(fakeSource())

      expect((await runner.fill('no-such-list')).outcome).toBe('list-gone')
      expect((await runner.fill((await listOfFilms(1, 'mystery')).id)).outcome).toBe('unsupported')
    })
  })

  it('counts what is still pending, which is the progress', async () => {
    const list = await listOfFilms(5)
    const runner = filler(fakeSource((ref) => (ref === 'movie:4' ? { status: 'failed', error: new Error('x') } : { status: 'found', minutes: 90 })))

    expect(await runner.pendingCount(list.id)).toBe(5)
    await runner.fill(list.id)
    expect(await runner.pendingCount(list.id)).toBe(1)
  })
})
