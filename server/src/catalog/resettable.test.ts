import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, findListWithStats, findListsWithStats } from './repository.js'
import { listCanBeReset } from './resettable.js'

describe('which lists can be reset to a source at all (Checkpoint C)', () => {
  it('a hand-made list cannot: it has nothing to go back to', () => {
    expect(listCanBeReset({ source: 'manual', sourceYaml: null })).toBe(false)
  })

  it('a file list can when its file was kept, and cannot when it was imported before the file was', () => {
    expect(listCanBeReset({ source: 'file', sourceYaml: 'title: T' })).toBe(true)
    expect(listCanBeReset({ source: 'file', sourceYaml: null })).toBe(false)
  })

  it('a fetched list and a community-library list can: their source is read when Reset runs', () => {
    for (const source of ['api', 'llm', 'canonical'] as const) expect(listCanBeReset({ source, sourceYaml: null })).toBe(true)
  })
})

describe('canReset on the list as the app reads it', () => {
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

  it('is on the list read and on the overview, false for a file list with no stored file', async () => {
    const legacy = await createList(harness.db, userId, { title: 'Star Wars', mediaType: 'movie', source: 'file' })
    const kept = await createList(harness.db, userId, { title: 'Kept', mediaType: 'movie', source: 'file', sourceYaml: 'title: Kept' })

    expect((await findListWithStats(harness.db, userId, legacy.id))?.canReset).toBe(false)
    expect((await findListWithStats(harness.db, userId, kept.id))?.canReset).toBe(true)
    expect(Object.fromEntries((await findListsWithStats(harness.db, userId)).map((list) => [list.title, list.canReset]))).toEqual({ 'Star Wars': false, Kept: true })
  })

  it('reaches the app in the API’s answers', async () => {
    const legacy = await createList(harness.db, userId, { title: 'Star Wars', mediaType: 'movie', source: 'file' })

    expect((await harness.app.inject({ method: 'GET', url: `/api/lists/${legacy.id}` })).json().canReset).toBe(false)
    expect((await harness.app.inject({ method: 'GET', url: '/api/lists' })).json()[0].canReset).toBe(false)
  })
})
