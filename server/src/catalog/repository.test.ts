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
  releaseTypeBucket,
  reorderListItems,
  ReorderMismatchError,
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

  it('creates a list owned by the given user', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Jackie Chan', mediaType: 'movie' })

    expect(list).toMatchObject({
      title: 'Jackie Chan',
      mediaType: 'movie',
      userId: ownerId,
      source: 'manual',
      externalRef: null,
    })
  })

  it("hides another user's list from reads, updates and deletes", async () => {
    const theirs = await createList(harness.db, strangerId, { title: 'Theirs', mediaType: 'movie' })

    expect(await findLists(harness.db, ownerId)).toEqual([])
    expect(await findList(harness.db, ownerId, theirs.id)).toBeUndefined()
    expect(await updateList(harness.db, ownerId, theirs.id, { title: 'Hijacked' })).toBeUndefined()
    expect(await deleteList(harness.db, ownerId, theirs.id)).toBe(false)

    // Still intact for its actual owner.
    expect((await findList(harness.db, strangerId, theirs.id))?.title).toBe('Theirs')
  })

  it("hides another user's items, reached through their list", async () => {
    const theirs = await createList(harness.db, strangerId, { title: 'Theirs', mediaType: 'movie' })
    const item = (await createListItem(harness.db, strangerId, theirs.id, {
      title: 'Police Story',
      timeToConsumeMinutes: 100,
    }))!

    expect(await findListItems(harness.db, ownerId, theirs.id)).toBeUndefined()
    expect(await findListItem(harness.db, ownerId, theirs.id, item.id)).toBeUndefined()
    expect(
      await updateListItem(harness.db, ownerId, theirs.id, item.id, { title: 'Hijacked' }),
    ).toBeUndefined()
    expect(await deleteListItem(harness.db, ownerId, theirs.id, item.id)).toBe(false)
    expect(
      await setListItemConsumed(harness.db, ownerId, theirs.id, item.id, true),
    ).toBeUndefined()
  })

  it('appends new items to the end of the list', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Discography', mediaType: 'music' })

    await createListItem(harness.db, ownerId, list.id, { title: 'First', timeToConsumeMinutes: 40 })
    await createListItem(harness.db, ownerId, list.id, { title: 'Second', timeToConsumeMinutes: 35 })
    await createListItem(harness.db, ownerId, list.id, { title: 'Third', timeToConsumeMinutes: 30 })

    expect(
      (await findListItems(harness.db, ownerId, list.id))?.map((item) => item.orderIndex),
    ).toEqual([0, 1, 2])
  })

  it('renumbers items to exactly the order given (task 6.7)', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Discography', mediaType: 'music' })
    const first = (await createListItem(harness.db, ownerId, list.id, {
      title: 'First',
      timeToConsumeMinutes: 40,
    }))!
    const second = (await createListItem(harness.db, ownerId, list.id, {
      title: 'Second',
      timeToConsumeMinutes: 35,
    }))!
    const third = (await createListItem(harness.db, ownerId, list.id, {
      title: 'Third',
      timeToConsumeMinutes: 30,
    }))!

    const reordered = await reorderListItems(harness.db, ownerId, list.id, [
      third.id,
      first.id,
      second.id,
    ])

    expect(reordered?.map((item) => item.title)).toEqual(['Third', 'First', 'Second'])
    expect(reordered?.map((item) => item.orderIndex)).toEqual([0, 1, 2])
  })

  it('rejects a reorder whose itemIds do not exactly match the list', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Discography', mediaType: 'music' })
    const first = (await createListItem(harness.db, ownerId, list.id, {
      title: 'First',
      timeToConsumeMinutes: 40,
    }))!
    await createListItem(harness.db, ownerId, list.id, { title: 'Second', timeToConsumeMinutes: 35 })

    // Missing an item.
    await expect(reorderListItems(harness.db, ownerId, list.id, [first.id])).rejects.toThrow(
      ReorderMismatchError,
    )
    // A duplicate.
    await expect(
      reorderListItems(harness.db, ownerId, list.id, [first.id, first.id]),
    ).rejects.toThrow(ReorderMismatchError)
    // An id from nowhere.
    await expect(
      reorderListItems(harness.db, ownerId, list.id, [first.id, 'not-a-real-id']),
    ).rejects.toThrow(ReorderMismatchError)
  })

  it("hides another user's items from a reorder", async () => {
    const theirs = await createList(harness.db, strangerId, { title: 'Theirs', mediaType: 'movie' })
    const item = (await createListItem(harness.db, strangerId, theirs.id, {
      title: 'Police Story',
      timeToConsumeMinutes: 100,
    }))!

    expect(await reorderListItems(harness.db, ownerId, theirs.id, [item.id])).toBeUndefined()
  })

  it('defaults durations to estimated, since a caller-supplied number is usually a guess', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Comics', mediaType: 'comic' })
    const estimated = await createListItem(harness.db, ownerId, list.id, {
      title: 'Issue #1',
      timeToConsumeMinutes: 15,
    })
    const known = await createListItem(harness.db, ownerId, list.id, {
      title: 'Issue #2',
      timeToConsumeMinutes: 22,
      timeToConsumeIsEstimated: false,
    })

    expect(estimated?.timeToConsumeIsEstimated).toBe(true)
    expect(known?.timeToConsumeIsEstimated).toBe(false)
  })

  it('records and clears consumption time', async () => {
    const list = await createList(harness.db, ownerId, { title: 'PPVs', mediaType: 'tv' })
    const item = (await createListItem(harness.db, ownerId, list.id, {
      title: 'WrestleMania',
      timeToConsumeMinutes: 240,
    }))!
    const consumedAt = new Date('2026-01-01T12:00:00Z')

    expect(item.consumedAt).toBeNull()

    const consumed = await setListItemConsumed(harness.db, ownerId, list.id, item.id, true, consumedAt)
    expect(consumed?.consumedAt).toEqual(consumedAt)

    const unconsumed = await setListItemConsumed(harness.db, ownerId, list.id, item.id, false)
    expect(unconsumed?.consumedAt).toBeNull()
  })

  it('deletes a list along with its items', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Franchise', mediaType: 'game' })
    await createListItem(harness.db, ownerId, list.id, { title: 'AC1', timeToConsumeMinutes: 900 })
    await createListItem(harness.db, ownerId, list.id, { title: 'AC2', timeToConsumeMinutes: 1200 })

    expect(await deleteList(harness.db, ownerId, list.id)).toBe(true)

    // Orphaned rows would quietly inflate future "time remaining" sums.
    const orphans = harness.db
      .select()
      .from(listItems)
      .where(eq(listItems.listId, list.id))
      .all()
    expect(orphans).toEqual([])
  })

  it('turning "group by type" on assigns each item\'s group from its release type', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Cannibal Corpse', mediaType: 'music' })
    const album = await createListItem(harness.db, ownerId, list.id, {
      title: 'Eaten Back to Life',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
    })
    const liveEp = await createListItem(harness.db, ownerId, list.id, {
      title: 'Live Cannibalism (Sampler)',
      timeToConsumeMinutes: 20,
      releaseType: 'EP · Live',
    })
    // Confirmed with the user: the special facet wins over the base type.
    const compilation = await createListItem(harness.db, ownerId, list.id, {
      title: 'Dead Human Collection',
      timeToConsumeMinutes: 60,
      releaseType: 'Album · Compilation',
    })

    await updateList(harness.db, ownerId, list.id, { groupByType: true })

    const items = (await findListItems(harness.db, ownerId, list.id))!
    expect(items.find((item) => item.id === album!.id)?.group).toBe('Album')
    expect(items.find((item) => item.id === liveEp!.id)?.group).toBe('Live')
    expect(items.find((item) => item.id === compilation!.id)?.group).toBe('Compilation')
  })

  it('turning "group by type" back off clears every group again', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Cannibal Corpse', mediaType: 'music' })
    await createListItem(harness.db, ownerId, list.id, {
      title: 'Eaten Back to Life',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
    })

    await updateList(harness.db, ownerId, list.id, { groupByType: true })
    await updateList(harness.db, ownerId, list.id, { groupByType: false })

    const items = (await findListItems(harness.db, ownerId, list.id))!
    expect(items.every((item) => item.group === null)).toBe(true)
  })

  it('physically groups same-bucket items together, not just labels them, so reordering-within-a-group (task 6.7) still works', async () => {
    // Real bug, found live: items stay in chronological order, so
    // interleaved release types were never physically adjacent — only
    // labeling `group` (the first version of this fix) left every same-type
    // item just as scattered as before, and `moveItem`/`moveItemTo`
    // (ListDetail.tsx) check the *physically* adjacent item.
    const list = await createList(harness.db, ownerId, { title: 'Cannibal Corpse', mediaType: 'music' })
    const album1990 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Eaten Back to Life',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
      year: 1990,
    })
    const ep2000 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Sacrifice / Confessions',
      timeToConsumeMinutes: 20,
      releaseType: 'EP',
      year: 2000,
    })
    const album2002 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Gore Obsessed',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
      year: 2002,
    })

    await updateList(harness.db, ownerId, list.id, { groupByType: true })

    const items = (await findListItems(harness.db, ownerId, list.id))!
    // The two albums (1990, 2002) must now sit next to each other, in
    // chronological order, ahead of the single EP — not still interleaved.
    expect(items.map((item) => item.id)).toEqual([album1990!.id, album2002!.id, ep2000!.id])
    expect(items.map((item) => item.orderIndex)).toEqual([0, 1, 2])
  })

  it('sorts sections into the fixed Album > EP > Single > Live > Compilation order, confirmed with the user', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Cannibal Corpse', mediaType: 'music' })
    // Deliberately created in a scrambled order, unrelated to the expected
    // bucket order or to chronology.
    const compilation = await createListItem(harness.db, ownerId, list.id, {
      title: 'Dead Human Collection',
      timeToConsumeMinutes: 60,
      releaseType: 'Album · Compilation',
      year: 2013,
    })
    const single = await createListItem(harness.db, ownerId, list.id, {
      title: 'Hammer Smashed Face',
      timeToConsumeMinutes: 5,
      releaseType: 'Single',
      year: 1993,
    })
    const live = await createListItem(harness.db, ownerId, list.id, {
      title: 'Global Evisceration',
      timeToConsumeMinutes: 60,
      releaseType: 'Album · Live',
      year: 2011,
    })
    const album = await createListItem(harness.db, ownerId, list.id, {
      title: 'Eaten Back to Life',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
      year: 1990,
    })
    const ep = await createListItem(harness.db, ownerId, list.id, {
      title: 'Worm Infested',
      timeToConsumeMinutes: 20,
      releaseType: 'EP',
      year: 2002,
    })

    await updateList(harness.db, ownerId, list.id, { groupByType: true })

    const items = (await findListItems(harness.db, ownerId, list.id))!
    expect(items.map((item) => item.id)).toEqual([
      album!.id,
      ep!.id,
      single!.id,
      live!.id,
      compilation!.id,
    ])
  })

  it('restores chronological order by year when turned back off', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Cannibal Corpse', mediaType: 'music' })
    const album2002 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Gore Obsessed',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
      year: 2002,
    })
    const ep2000 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Sacrifice / Confessions',
      timeToConsumeMinutes: 20,
      releaseType: 'EP',
      year: 2000,
    })
    const album1990 = await createListItem(harness.db, ownerId, list.id, {
      title: 'Eaten Back to Life',
      timeToConsumeMinutes: 45,
      releaseType: 'Album',
      year: 1990,
    })

    await updateList(harness.db, ownerId, list.id, { groupByType: true })
    await updateList(harness.db, ownerId, list.id, { groupByType: false })

    const items = (await findListItems(harness.db, ownerId, list.id))!
    expect(items.map((item) => item.id)).toEqual([album1990!.id, ep2000!.id, album2002!.id])
  })

  it('leaves every item\'s group untouched when the patch has nothing to do with grouping', async () => {
    const list = await createList(harness.db, ownerId, { title: 'Some TV Show', mediaType: 'tv' })
    const item = await createListItem(harness.db, ownerId, list.id, {
      title: 'Episode 1',
      timeToConsumeMinutes: 25,
      group: 'Season 1',
    })

    await updateList(harness.db, ownerId, list.id, { title: 'Renamed' })

    expect((await findListItem(harness.db, ownerId, list.id, item!.id))?.group).toBe('Season 1')
  })
})

describe('releaseTypeBucket', () => {
  it('returns null for no release type', () => {
    expect(releaseTypeBucket(null)).toBeNull()
    expect(releaseTypeBucket(undefined)).toBeNull()
  })

  it('returns the base type alone unchanged', () => {
    expect(releaseTypeBucket('Album')).toBe('Album')
    expect(releaseTypeBucket('EP')).toBe('EP')
    expect(releaseTypeBucket('Single')).toBe('Single')
  })

  it('prefers Compilation and Live over the base type', () => {
    expect(releaseTypeBucket('Album · Live')).toBe('Live')
    expect(releaseTypeBucket('EP · Live')).toBe('Live')
    expect(releaseTypeBucket('Album · Compilation')).toBe('Compilation')
  })

  it('prefers Compilation over Live when a release is somehow both', () => {
    expect(releaseTypeBucket('Album · Live · Compilation')).toBe('Compilation')
  })
})
