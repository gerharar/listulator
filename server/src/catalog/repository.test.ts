import { eq } from 'drizzle-orm'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import {
  createList,
  createListItem,
  deleteList,
  deleteListItem,
  findList,
  findListItem,
  findListItems,
  findLists,
  setListItemConsumed,
  updateList,
  updateListItem,
} from './repository.js'

/**
 * These exercise the scoping guarantees directly, with two users in the
 * database. The HTTP layer only ever sees one user in single-user mode, so
 * cross-user isolation cannot be proven through it — but it is the promise
 * that makes multi-tenancy a config flip (SPEC.md §11), so it gets tested at
 * the layer where it is actually enforced.
 */
describe('catalog repository', () => {
  let harness: TestApp
  let ownerId: string
  let strangerId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()

    ownerId = harness.db.select().from(users).get()!.id
    strangerId = harness.db.insert(users).values({}).returning().get().id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('creates a list owned by the given user', () => {
    const list = createList(harness.db, ownerId, { title: 'Jackie Chan', mediaType: 'movie' })

    expect(list).toMatchObject({
      title: 'Jackie Chan',
      mediaType: 'movie',
      userId: ownerId,
      source: 'manual',
      externalRef: null,
    })
  })

  it("hides another user's list from reads, updates and deletes", () => {
    const theirs = createList(harness.db, strangerId, { title: 'Theirs', mediaType: 'movie' })

    expect(findLists(harness.db, ownerId)).toEqual([])
    expect(findList(harness.db, ownerId, theirs.id)).toBeUndefined()
    expect(updateList(harness.db, ownerId, theirs.id, { title: 'Hijacked' })).toBeUndefined()
    expect(deleteList(harness.db, ownerId, theirs.id)).toBe(false)

    // Still intact for its actual owner.
    expect(findList(harness.db, strangerId, theirs.id)?.title).toBe('Theirs')
  })

  it("hides another user's items, reached through their list", () => {
    const theirs = createList(harness.db, strangerId, { title: 'Theirs', mediaType: 'movie' })
    const item = createListItem(harness.db, strangerId, theirs.id, {
      title: 'Police Story',
      timeToConsumeMinutes: 100,
    })!

    expect(findListItems(harness.db, ownerId, theirs.id)).toBeUndefined()
    expect(findListItem(harness.db, ownerId, theirs.id, item.id)).toBeUndefined()
    expect(
      updateListItem(harness.db, ownerId, theirs.id, item.id, { title: 'Hijacked' }),
    ).toBeUndefined()
    expect(deleteListItem(harness.db, ownerId, theirs.id, item.id)).toBe(false)
    expect(
      setListItemConsumed(harness.db, ownerId, theirs.id, item.id, true),
    ).toBeUndefined()
  })

  it('appends new items to the end of the list', () => {
    const list = createList(harness.db, ownerId, { title: 'Discography', mediaType: 'music' })

    createListItem(harness.db, ownerId, list.id, { title: 'First', timeToConsumeMinutes: 40 })
    createListItem(harness.db, ownerId, list.id, { title: 'Second', timeToConsumeMinutes: 35 })
    createListItem(harness.db, ownerId, list.id, { title: 'Third', timeToConsumeMinutes: 30 })

    expect(findListItems(harness.db, ownerId, list.id)?.map((item) => item.orderIndex)).toEqual([
      0, 1, 2,
    ])
  })

  it('defaults durations to estimated, since a caller-supplied number is usually a guess', () => {
    const list = createList(harness.db, ownerId, { title: 'Comics', mediaType: 'comic' })
    const estimated = createListItem(harness.db, ownerId, list.id, {
      title: 'Issue #1',
      timeToConsumeMinutes: 15,
    })
    const known = createListItem(harness.db, ownerId, list.id, {
      title: 'Issue #2',
      timeToConsumeMinutes: 22,
      timeToConsumeIsEstimated: false,
    })

    expect(estimated?.timeToConsumeIsEstimated).toBe(true)
    expect(known?.timeToConsumeIsEstimated).toBe(false)
  })

  it('records and clears consumption time', () => {
    const list = createList(harness.db, ownerId, { title: 'PPVs', mediaType: 'tv' })
    const item = createListItem(harness.db, ownerId, list.id, {
      title: 'WrestleMania',
      timeToConsumeMinutes: 240,
    })!
    const consumedAt = new Date('2026-01-01T12:00:00Z')

    expect(item.consumedAt).toBeNull()

    const consumed = setListItemConsumed(harness.db, ownerId, list.id, item.id, true, consumedAt)
    expect(consumed?.consumedAt).toEqual(consumedAt)

    const unconsumed = setListItemConsumed(harness.db, ownerId, list.id, item.id, false)
    expect(unconsumed?.consumedAt).toBeNull()
  })

  it('deletes a list along with its items', () => {
    const list = createList(harness.db, ownerId, { title: 'Franchise', mediaType: 'game' })
    createListItem(harness.db, ownerId, list.id, { title: 'AC1', timeToConsumeMinutes: 900 })
    createListItem(harness.db, ownerId, list.id, { title: 'AC2', timeToConsumeMinutes: 1200 })

    expect(deleteList(harness.db, ownerId, list.id)).toBe(true)

    // Orphaned rows would quietly inflate future "time remaining" sums.
    const orphans = harness.db
      .select()
      .from(listItems)
      .where(eq(listItems.listId, list.id))
      .all()
    expect(orphans).toEqual([])
  })
})
