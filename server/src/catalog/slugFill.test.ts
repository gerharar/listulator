import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { users } from '../db/schema.js'
import type { MediaType } from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { missingSlugRefs, slugsForList } from './itemSlugs.js'
import { createList, createListItem } from './repository.js'
import { createSlugFiller } from './slugFill.js'

/**
 * H-002 (BL-087), IGDB: a page address needs a slug the item does not carry, so the app looks them up in the
 * background when a list is opened. The owner's worry is performance (2026-10-14), so what these pin is as much what
 * it does NOT do as what it does: nothing for a list with nothing to look up, nothing twice at once, nothing again
 * straight after a failure, never more than IGDB's ceiling in a request.
 */
describe('the background lookup of page slugs', () => {
  let harness: TestApp
  let owner: string
  let clock: number

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    owner = harness.db.select().from(users).get()!.id
    clock = Date.parse('2026-10-14T12:00:00Z')
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const db = () => harness.db
  const now = () => new Date(clock)

  /** A source of slugs: `game:N` has slug `slug-N`, except the ids in `none`; `gate` holds an answer back. */
  function source(options: { none?: number[]; available?: boolean; fail?: () => boolean } = {}) {
    let release: (() => void) | undefined
    let held: Promise<void> | undefined
    const slugs = vi.fn(async (refs: string[]) => {
      await held
      if (options.fail?.()) throw new Error('IGDB is down')

      return new Map(refs.map((ref): [string, string | null] => [ref, options.none?.includes(Number(ref.slice(5))) ? null : `slug-${ref.slice(5)}`]))
    })
    const mediaType: MediaType = {
      key: 'game',
      label: 'Games',
      sortOrder: 1,
      defaultDurationMinutes: 600,
      sourceName: 'IGDB',
      adapter: {
        isAvailable: () => options.available ?? true,
        search: async () => [],
        expand: async () => ({ items: [] }),
        slugPrefixes: ['game'],
        slugs,
      },
    }

    return {
      mediaType,
      slugs,
      holdAnswers: () => {
        held = new Promise<void>((resolve) => (release = resolve))
      },
      releaseAnswers: () => release?.(),
    }
  }

  const gameList = async (count: number, from = 1) => {
    const list = await createList(db(), owner, { title: 'Games', mediaType: 'game', source: 'api', externalRef: 'franchise:1' })
    for (let n = from; n < from + count; n += 1) {
      await createListItem(db(), owner, list.id, { title: `Game ${n}`, timeToConsumeMinutes: 600, source: 'import', externalRef: `game:${n}` })
    }

    return list
  }

  const filler = (extra: Partial<Parameters<typeof createSlugFiller>[0]> = {}) => createSlugFiller({ db: db(), now, ...extra })

  it('looks up the slugs a list is missing and remembers them', async () => {
    const igdb = source()
    const list = await gameList(3)
    const fill = filler()

    expect(fill.start(list.id, igdb.mediaType)).toBe(true)
    await fill.idle(list.id)

    expect(igdb.slugs).toHaveBeenCalledExactlyOnceWith(['game:1', 'game:2', 'game:3'])
    expect([...(await slugsForList(db(), list.id))]).toEqual([['game:1', 'slug-1'], ['game:2', 'slug-2'], ['game:3', 'slug-3']])
  })

  it('remembers "none" as an answer, so the same games are not asked at every opening', async () => {
    const igdb = source({ none: [2] })
    const list = await gameList(3)
    const fill = filler()

    fill.start(list.id, igdb.mediaType)
    await fill.idle(list.id)

    expect((await slugsForList(db(), list.id)).get('game:2')).toBeNull()
    expect(await missingSlugRefs(db(), list.id, ['game'])).toEqual([])
  })

  it('asks for no more than IGDB’s ceiling at a time, and keeps each batch as it arrives', async () => {
    const igdb = source()
    const list = await gameList(1200)
    const fill = filler()

    fill.start(list.id, igdb.mediaType)
    await fill.idle(list.id)

    expect(igdb.slugs.mock.calls.map(([refs]) => refs.length)).toEqual([500, 500, 200])
    expect((await slugsForList(db(), list.id)).size).toBe(1200)
  })

  it('asks only for what is missing: a game already answered, in this list or another, is not asked again', async () => {
    const igdb = source()
    const earlier = await gameList(2)
    const fill = filler()
    fill.start(earlier.id, igdb.mediaType)
    await fill.idle(earlier.id)
    igdb.slugs.mockClear()

    const later = await gameList(3, 2)
    fill.start(later.id, igdb.mediaType)
    await fill.idle(later.id)

    expect(igdb.slugs).toHaveBeenCalledExactlyOnceWith(['game:3', 'game:4'])
  })

  it('does nothing, and says so, when every item is answered', async () => {
    const igdb = source()
    const list = await gameList(2)
    const fill = filler()
    fill.start(list.id, igdb.mediaType)
    await fill.idle(list.id)
    igdb.slugs.mockClear()

    fill.start(list.id, igdb.mediaType)
    await fill.idle(list.id)

    expect(igdb.slugs).not.toHaveBeenCalled()
  })

  it('has one lookup per list at a time: asking while it runs joins it', async () => {
    const igdb = source()
    igdb.holdAnswers()
    const list = await gameList(2)
    const fill = filler()

    expect(fill.start(list.id, igdb.mediaType)).toBe(true)
    expect(fill.start(list.id, igdb.mediaType)).toBe(true)
    expect(fill.start(list.id, igdb.mediaType)).toBe(true)
    igdb.releaseAnswers()
    await fill.idle(list.id)

    expect(igdb.slugs).toHaveBeenCalledTimes(1)
  })

  describe('what it will not do', () => {
    it('start nothing for a category whose addresses need no slug', async () => {
      const list = await gameList(2)
      const plain: MediaType = { key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 100, adapter: { isAvailable: () => true, search: async () => [], expand: async () => ({ items: [] }) } }
      const fill = filler()

      expect(fill.start(list.id, plain)).toBe(false)
      expect(fill.start(list.id, undefined)).toBe(false)
    })

    it('ask a source that cannot answer (no key), and say the links are not coming', async () => {
      const igdb = source({ available: false })
      const list = await gameList(2)
      const fill = filler()

      expect(fill.start(list.id, igdb.mediaType)).toBe(false)
      expect(igdb.slugs).not.toHaveBeenCalled()
    })

    it('forget a batch that failed, keep the earlier ones, and not ask again until the cooldown is over', async () => {
      let calls = 0
      const igdb = source({ fail: () => ++calls === 2 })
      const list = await gameList(700)
      const fill = filler({ cooldownMs: 60_000 })

      expect(fill.start(list.id, igdb.mediaType)).toBe(true)
      await fill.idle(list.id)

      // The first 500 are kept, the failed batch is not remembered as anything.
      expect((await slugsForList(db(), list.id)).size).toBe(500)
      expect(await missingSlugRefs(db(), list.id, ['game'])).toHaveLength(200)

      // Straight after: nothing is asked, and the links are not "coming".
      igdb.slugs.mockClear()
      expect(fill.start(list.id, igdb.mediaType)).toBe(false)
      expect(igdb.slugs).not.toHaveBeenCalled()

      // After the cooldown it tries again, and finishes.
      clock += 60_001
      expect(fill.start(list.id, igdb.mediaType)).toBe(true)
      await fill.idle(list.id)
      expect((await slugsForList(db(), list.id)).size).toBe(700)
    })

    it('go round again for the games the source left out of its answer, but wait before asking them again', async () => {
      const igdb = source()
      igdb.slugs.mockImplementation(async (refs: string[]) => new Map(refs.slice(0, 1).map((ref): [string, string | null] => [ref, 'only-one'])))
      const list = await gameList(3)
      const fill = filler({ cooldownMs: 60_000 })

      fill.start(list.id, igdb.mediaType)
      await fill.idle(list.id)

      expect(igdb.slugs).toHaveBeenCalledTimes(1)
      expect(fill.start(list.id, igdb.mediaType)).toBe(false)
    })

    it('stop after the batch in hand when the app closes', async () => {
      const igdb = source()
      const stop = new AbortController()
      igdb.slugs.mockImplementation(async (refs: string[]) => {
        stop.abort()

        return new Map(refs.map((ref): [string, string | null] => [ref, 'x']))
      })
      const list = await gameList(1200)
      const fill = filler({ signal: stop.signal })

      fill.start(list.id, igdb.mediaType)
      await fill.idle(list.id)

      expect(igdb.slugs).toHaveBeenCalledTimes(1)
    })

    it('give up on a lookup that never answers, so the links are not "coming" for ever and the screen stops polling', async () => {
      const igdb = source()
      igdb.slugs.mockImplementation(() => new Promise<Map<string, string | null>>(() => {}))
      const list = await gameList(3)
      const onError = vi.fn()
      const fill = filler({ runTimeoutMs: 30, cooldownMs: 60_000, onError })

      expect(fill.start(list.id, igdb.mediaType)).toBe(true)
      await fill.idle(list.id)

      expect(onError).toHaveBeenCalledTimes(1)
      expect(String(onError.mock.calls[0]![0])).toMatch(/did not finish/)
      // The list is left alone for a while, as after any failure.
      expect(fill.start(list.id, igdb.mediaType)).toBe(false)
      clock += 60_001
      expect(fill.start(list.id, igdb.mediaType)).toBe(true)
    })

    it('not start another batch after giving up, even if the old request answers late', async () => {
      const igdb = source()
      let answerLate!: () => void
      igdb.slugs.mockImplementation(
        (refs: string[]) => new Promise<Map<string, string | null>>((resolve) => (answerLate = () => resolve(new Map(refs.map((ref): [string, string | null] => [ref, 'late'])))))
      )
      const list = await gameList(1200)
      const fill = filler({ runTimeoutMs: 30 })

      fill.start(list.id, igdb.mediaType)
      await fill.idle(list.id)
      answerLate()
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(igdb.slugs).toHaveBeenCalledTimes(1)
    })

    it('report a failure to whoever listens, and never throw out of the background', async () => {
      const igdb = source({ fail: () => true })
      const list = await gameList(2)
      const onError = vi.fn()
      const fill = filler({ onError })

      fill.start(list.id, igdb.mediaType)
      await expect(fill.idle(list.id)).resolves.toBeUndefined()

      expect(onError).toHaveBeenCalledTimes(1)
    })
  })
})
