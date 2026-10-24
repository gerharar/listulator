import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lists, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, deleteList, findListWithStats, updateList } from './repository.js'
import { restoreList } from './restore.js'

/** The sample mark (H-018, 33.7): a list's own flag, set by whoever makes a sample, cleared by Keep It, and kept through a delete and its Undo. */
describe('the sample mark on a list', () => {
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

  it('is false on a list nobody marked', async () => {
    const list = await createList(harness.db, userId, { title: 'Mine', mediaType: 'tv' })

    expect(list.isSample).toBe(false)
    expect((await findListWithStats(harness.db, userId, list.id))?.isSample).toBe(false)
  })

  it('can be given at creation, and cleared by an update (Keep It), which changes nothing else', async () => {
    const made = await createList(harness.db, userId, { title: 'A sample', mediaType: 'tv', isSample: true })
    expect(made.isSample).toBe(true)

    const kept = await updateList(harness.db, userId, made.id, { isSample: false })

    expect(kept?.isSample).toBe(false)
    expect(kept?.title).toBe('A sample')
    expect((await findListWithStats(harness.db, userId, made.id))?.isSample).toBe(false)
  })

  it('stays on the list when a delete is undone', async () => {
    const made = await createList(harness.db, userId, { title: 'A sample', mediaType: 'tv', isSample: true })

    const restore = await deleteList(harness.db, userId, made.id)
    expect(restore?.list.isSample).toBe(true)
    await restoreList(harness.db, userId, restore!)

    expect(harness.db.select().from(lists).get()?.isSample).toBe(true)
  })

  it('is restored as false from an Undo payload that predates the mark', async () => {
    const made = await createList(harness.db, userId, { title: 'Old', mediaType: 'tv' })
    const restore = await deleteList(harness.db, userId, made.id)
    const older = { ...restore!.list }
    delete older.isSample

    await restoreList(harness.db, userId, { ...restore!, list: older })

    expect(harness.db.select().from(lists).get()?.isSample).toBe(false)
  })

  it('is read in a list response, and Keep It is a PATCH with isSample false', async () => {
    const made = await createList(harness.db, userId, { title: 'A sample', mediaType: 'tv', isSample: true })

    const before = await harness.app.inject({ method: 'GET', url: `/api/lists/${made.id}` })
    expect(before.json().isSample).toBe(true)

    const patched = await harness.app.inject({ method: 'PATCH', url: `/api/lists/${made.id}`, payload: { isSample: false } })

    expect(patched.statusCode).toBe(200)
    expect(patched.json().isSample).toBe(false)
  })

  it('refuses a mark that is not true or false', async () => {
    const made = await createList(harness.db, userId, { title: 'A sample', mediaType: 'tv' })

    const response = await harness.app.inject({ method: 'PATCH', url: `/api/lists/${made.id}`, payload: { isSample: 'yes' } })

    expect(response.statusCode).toBe(400)
  })
})
