import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createList, createListItem, setListItemConsumed } from '../catalog/repository.js'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'

/**
 * Drives the three buttons end to end against the *shipped* strategy files,
 * over fixture lists whose ranking is worked out by hand below.
 */
describe('suggestion endpoints', () => {
  let harness: TestApp
  let userId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()
    userId = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  /** Builds a list of `count` items of `minutes` each, consuming the first `consumed`. */
  function seed(
    title: string,
    { count, minutes, consumed = 0, lastConsumed }: {
      count: number
      minutes: number
      consumed?: number
      lastConsumed?: Date
    },
  ) {
    const list = createList(harness.db, userId, { title, mediaType: 'movie' })

    for (let index = 0; index < count; index += 1) {
      const item = createListItem(harness.db, userId, list.id, {
        title: `${title} #${index + 1}`,
        timeToConsumeMinutes: minutes,
      })!

      if (index < consumed) {
        setListItemConsumed(harness.db, userId, list.id, item.id, true, lastConsumed ?? daysAgo(1))
      }
    }

    return list
  }

  async function picks(url: string, payload?: unknown) {
    const response = await harness.app.inject(
      payload
        ? { method: 'POST', url, payload }
        : { method: 'GET', url },
    )

    expect(response.statusCode).toBe(200)

    return response.json().picks as {
      list: { id: string; title: string }
      nextItem: { title: string } | null
      score: number
    }[]
  }

  it('“I’m tired, boss” skips the named list and favours neglected, nearly-done ones', async () => {
    const tiredOf = seed('Assassin’s Creed', { count: 10, minutes: 900, consumed: 5 })
    // Long ignored and nearly finished — exactly what this button is for.
    const almostDone = seed('Fantastic Four', {
      count: 10,
      minutes: 15,
      consumed: 9,
      lastConsumed: daysAgo(200),
    })
    // Ignored just as long, but barely started.
    seed('Cannibal Corpse', { count: 10, minutes: 45, consumed: 1, lastConsumed: daysAgo(200) })

    const results = await picks('/api/suggestions/tired-boss', { currentListId: tiredOf.id })

    expect(results.map((pick) => pick.list.id)).not.toContain(tiredOf.id)
    expect(results[0]?.list.id).toBe(almostDone.id)
    expect(results[0]?.nextItem?.title).toBe('Fantastic Four #10')
  })

  it('“Suggest” favours barely-started lists and buries the half-finished', async () => {
    const barelyStarted = seed('Jackie Chan', {
      count: 10,
      minutes: 110,
      consumed: 1,
      lastConsumed: daysAgo(150),
    })
    const halfDone = seed('WWF PPVs', {
      count: 10,
      minutes: 150,
      consumed: 5,
      lastConsumed: daysAgo(150),
    })
    const nearlyDone = seed('Bond films', {
      count: 10,
      minutes: 130,
      consumed: 9,
      lastConsumed: daysAgo(150),
    })

    const results = await picks('/api/suggestions/suggest')
    const order = results.map((pick) => pick.list.id)

    // Both ends beat the middle, and the fresh end wins outright: the stuck
    // half-finished list is the one thing this button should never offer.
    expect(order).toEqual([barelyStarted.id, nearlyDone.id, halfDone.id])
  })

  it('“Quickie” answers with the list that takes least time to finish', async () => {
    seed('Jackie Chan', { count: 10, minutes: 110 })
    const quick = seed('Cannibal Corpse', { count: 3, minutes: 40 })
    seed('Assassin’s Creed', { count: 5, minutes: 900 })

    const results = await picks('/api/suggestions/quickie')

    expect(results[0]?.list.id).toBe(quick.id)
    expect(results[0]?.nextItem?.title).toBe('Cannibal Corpse #1')
  })

  it('never suggests a finished list, which would otherwise win Quickie outright', async () => {
    const finished = seed('Finished', { count: 3, minutes: 30, consumed: 3 })
    const unfinished = seed('Unfinished', { count: 3, minutes: 90 })

    const results = await picks('/api/suggestions/quickie')

    expect(results.map((pick) => pick.list.id)).toEqual([unfinished.id])
    expect(results.map((pick) => pick.list.id)).not.toContain(finished.id)
  })

  it('never suggests an empty list', async () => {
    createList(harness.db, userId, { title: 'Empty', mediaType: 'movie' })
    const real = seed('Real', { count: 2, minutes: 30 })

    const results = await picks('/api/suggestions/suggest')

    expect(results.map((pick) => pick.list.id)).toEqual([real.id])
  })

  it('returns nothing rather than inventing an answer when there is nothing to do', async () => {
    seed('All done', { count: 2, minutes: 30, consumed: 2 })

    expect(await picks('/api/suggestions/quickie')).toEqual([])
  })

  it('requires the list you are tired of, and will not guess it', async () => {
    seed('Something', { count: 2, minutes: 30 })

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/suggestions/tired-boss',
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })

  it('reports a broken strategy file clearly instead of a bare 500', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duldulator-bad-strategies-'))
    writeFileSync(join(directory, 'quickie.json'), '{ "name": "quickie", "factors": [] }')

    const broken = createTestApp({ strategiesDir: directory })
    await broken.app.ready()
    const brokenUserId = broken.db.select().from(users).get()!.id
    createList(broken.db, brokenUserId, { title: 'Anything', mediaType: 'movie' })

    const response = await broken.app.inject({ method: 'GET', url: '/api/suggestions/quickie' })

    expect(response.statusCode).toBe(500)
    expect(response.json().message).toMatch(/quickie\.json/)
    expect(response.json().message).toMatch(/non-empty array/)

    await broken.cleanup()
    rmSync(directory, { recursive: true, force: true })
  })
})
