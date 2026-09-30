import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissedItems,
  listGroups,
  listItems,
  listSnapshots,
  lists,
  users,
  type List,
} from '../db/schema.js'
import {
  createMediaTypeRegistry,
  type ListExpansion,
  type MediaTypeRegistry,
} from '../ingestion/mediaTypes.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListGroup, renameListGroup } from './groups.js'
import {
  createList,
  createListItem,
  deleteListItem,
  findList,
  findListItems,
  findListSnapshot,
  setListItemConsumed,
  updateList,
  updateListItem,
} from './repository.js'
import {
  dropSourceCopy,
  refreshOrDropSourceCopy,
  refreshSourceCopy,
  SourceCopyEmptyError,
  SourceCopyUnavailableError,
} from './sourceCopy.js'

/**
 * Task 12.2: the stored source copy of a fetched list is replaced from its
 * source, and nothing the user owns is touched. The copy is `list_snapshots`
 * plus `lists.arrived_status` and `lists.snapshot_fetched_at`.
 */
describe('refreshSourceCopy', () => {
  let harness: TestApp
  let registry: MediaTypeRegistry
  let userId: string
  /** What the fake source says right now; a test changes it between import and refresh. */
  let upstream: ListExpansion
  let expand: ReturnType<typeof vi.fn<() => Promise<ListExpansion>>>

  const FETCHED = new Date('2026-09-01T10:00:00.000Z')
  const REFRESHED = new Date('2026-09-28T10:00:00.000Z')

  beforeEach(async () => {
    upstream = {
      items: [
        { title: 'Episode 1', externalRef: 'v1', timeToConsumeMinutes: 20 },
        { title: 'Episode 2', externalRef: 'v2', timeToConsumeMinutes: 25 },
        { title: 'Episode 3', externalRef: 'v3' },
      ],
      status: 'ongoing',
    }
    expand = vi.fn(async () => upstream)
    registry = createMediaTypeRegistry([
      {
        key: 'youtube',
        label: 'YouTube',
        sortOrder: 10,
        defaultDurationMinutes: 45,
        sourceName: 'YouTube',
        sourceCopyMaxDays: 30,
        adapter: { isAvailable: () => true, search: async () => [], expand },
      },
      { key: 'wrestling', label: 'Wrestling', sortOrder: 20, defaultDurationMinutes: 150 },
    ])
    harness = createTestApp({ mediaTypes: registry })
    // The default user is made by the first request.
    await harness.app.inject({ method: 'GET', url: '/api/lists' })
    userId = harness.db.select().from(users).get()!.id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const deps = () => ({ mediaTypes: registry.list() })

  /** A list fetched through the real import route, then dated to a known moment. */
  async function fetchList(title = 'Dungeon Soup'): Promise<List> {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/lists/from-source',
      payload: { mediaType: 'youtube', externalRef: 'PL123', title },
    })
    expect(response.statusCode).toBe(201)
    await harness.db.update(lists).set({ snapshotFetchedAt: FETCHED }).run()

    return (await findList(harness.db, userId, response.json().id))!
  }

  const snapshotRows = async (list: List) =>
    (await findListSnapshot(harness.db, userId, list.id)).map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && key !== 'listId')),
    )

  /** Every row of every table the user owns, in a stable order. */
  async function userOwned(listId: string) {
    const list = (await findList(harness.db, userId, listId))!
    // The two columns a refresh is meant to move.
    const kept = Object.fromEntries(
      Object.entries(list).filter(([key]) => key !== 'arrivedStatus' && key !== 'snapshotFetchedAt'),
    )

    return {
      list: kept,
      items: harness.db.select().from(listItems).orderBy(listItems.id).all(),
      groups: harness.db.select().from(listGroups).orderBy(listGroups.id).all(),
      dismissed: harness.db.select().from(dismissedItems).orderBy(dismissedItems.id).all(),
      users: harness.db.select().from(users).all(),
    }
  }

  it('replaces the snapshot with what the source says now, and dates it', async () => {
    const list = await fetchList()
    upstream = {
      items: [
        { title: 'Episode 1', externalRef: 'v1', timeToConsumeMinutes: 20 },
        { title: 'Episode 3 (re-cut)', externalRef: 'v3', timeToConsumeMinutes: 31 },
        { title: 'Episode 4', externalRef: 'v4' },
      ],
      status: 'complete',
    }

    const result = await refreshSourceCopy(harness.db, list, deps(), REFRESHED)

    expect(result).toEqual({ items: 3 })
    expect(await snapshotRows(list)).toMatchObject([
      { title: 'Episode 1', orderIndex: 0, externalRef: 'v1', timeToConsumeMinutes: 20, timeToConsumeIsEstimated: false },
      { title: 'Episode 3 (re-cut)', orderIndex: 1, externalRef: 'v3', timeToConsumeMinutes: 31, timeToConsumeIsEstimated: false },
      { title: 'Episode 4', orderIndex: 2, externalRef: 'v4', timeToConsumeMinutes: 45, timeToConsumeIsEstimated: true },
    ])
    const after = (await findList(harness.db, userId, list.id))!
    expect(after.snapshotFetchedAt).toEqual(REFRESHED)
    expect(after.arrivedStatus).toBe('complete')
  })

  it('fetches from the stored ref, live, and never from the expansion cache', async () => {
    const list = await fetchList()
    expand.mockClear()

    await refreshSourceCopy(harness.db, list, deps(), REFRESHED)

    expect(expand).toHaveBeenCalledExactlyOnceWith('PL123')
  })

  it('touches nothing the user owns: edited, added, removed and ticked items, groups and dismissals stay byte-identical', async () => {
    const list = await fetchList()
    const items = (await findListItems(harness.db, userId, list.id))!
    await updateListItem(harness.db, userId, list.id, items[0]!.id, {
      title: 'My name for episode 1',
      timeToConsumeMinutes: 99,
      tags: ['favourite'],
    })
    await setListItemConsumed(harness.db, userId, list.id, items[1]!.id, true)
    await deleteListItem(harness.db, userId, list.id, items[2]!.id)
    await createListItem(harness.db, userId, list.id, {
      title: 'Something I added',
      timeToConsumeMinutes: 10,
      source: 'manual',
      group: 'Mine',
    })
    const empty = (await createListGroup(harness.db, userId, list.id, 'Empty for now'))!
    await renameListGroup(harness.db, userId, list.id, empty.id, 'Still empty')
    await updateList(harness.db, userId, list.id, { title: 'My Dungeon Soup' })
    const before = await userOwned(list.id)

    upstream = {
      items: [
        { title: 'Episode 1', externalRef: 'v1', timeToConsumeMinutes: 20 },
        { title: 'Brand new', externalRef: 'v9', group: 'Season 2' },
      ],
    }
    await refreshSourceCopy(harness.db, (await findList(harness.db, userId, list.id))!, deps(), REFRESHED)

    expect(await userOwned(list.id)).toEqual(before)
    expect((await findListSnapshot(harness.db, userId, list.id)).map((row) => row.title)).toEqual([
      'Episode 1',
      'Brand new',
    ])
  })

  it('leaves the list’s own title, description and status as the user has them', async () => {
    const list = await fetchList()
    await updateList(harness.db, userId, list.id, { title: 'Renamed', description: 'Mine' })
    const updatedAtBefore = (await findList(harness.db, userId, list.id))!.updatedAt
    upstream = { items: [{ title: 'Only one', externalRef: 'v1' }], status: 'complete' }

    await refreshSourceCopy(harness.db, (await findList(harness.db, userId, list.id))!, deps(), REFRESHED)

    const after = (await findList(harness.db, userId, list.id))!
    expect(after).toMatchObject({ title: 'Renamed', description: 'Mine', status: 'ongoing', arrivedTitle: 'Dungeon Soup' })
    expect(after.updatedAt).toEqual(updatedAtBefore)
  })

  it('writes the same snapshot a fresh import of the same items would: order, groups, tags, default minutes', async () => {
    const shelf: ListExpansion = {
      items: [
        { title: 'Pilot', externalRef: 'a', group: 'Season 1', tags: ['Live', 'live', ' '] },
        { title: 'Loose', externalRef: 'b' },
        { title: 'Finale', externalRef: 'c', group: 'season 1', timeToConsumeMinutes: 61 },
        { title: 'Opener', externalRef: 'd', group: 'Season 2', year: 2020, notes: 'A note' },
        { title: 'Other loose', externalRef: 'e' },
        { title: 'Second', externalRef: 'f', group: ' Season 2 ' },
      ],
    }
    upstream = shelf
    const fresh = await fetchList('Fresh')
    upstream = { items: [{ title: 'Something else entirely', externalRef: 'zzz' }] }
    const stale = await fetchList('Stale')
    upstream = shelf

    await refreshSourceCopy(harness.db, stale, deps(), REFRESHED)

    expect(await snapshotRows(stale)).toEqual(await snapshotRows(fresh))
  })

  it('refuses a source that now expands to nothing, keeping the copy it has', async () => {
    const list = await fetchList()
    const before = await snapshotRows(list)
    upstream = { items: [] }

    await expect(refreshSourceCopy(harness.db, list, deps(), REFRESHED)).rejects.toBeInstanceOf(
      SourceCopyEmptyError,
    )

    expect(await snapshotRows(list)).toEqual(before)
    expect((await findList(harness.db, userId, list.id))!.snapshotFetchedAt).toEqual(FETCHED)
  })

  it('keeps the copy, its date and its status when the source cannot be reached', async () => {
    const list = await fetchList()
    const before = await snapshotRows(list)
    expand.mockRejectedValueOnce(new Error('quota exceeded'))

    await expect(refreshSourceCopy(harness.db, list, deps(), REFRESHED)).rejects.toThrow('quota exceeded')

    expect(await snapshotRows(list)).toEqual(before)
    expect(await findList(harness.db, userId, list.id)).toMatchObject({
      snapshotFetchedAt: FETCHED,
      arrivedStatus: 'ongoing',
    })
  })

  it('refuses a list with nothing to refresh from', async () => {
    const byHand = await createList(harness.db, userId, { title: 'By hand', mediaType: 'youtube' })
    const canonical = await createList(harness.db, userId, {
      title: 'Curated',
      mediaType: 'youtube',
      source: 'canonical',
      externalRef: 'canonical:youtube/curated.yaml',
    })
    const unknownCategory = await createList(harness.db, userId, {
      title: 'Gone',
      mediaType: 'podcast',
      source: 'api',
      externalRef: 'x',
    })
    const noAdapter = await createList(harness.db, userId, {
      title: 'No adapter',
      mediaType: 'wrestling',
      source: 'api',
      externalRef: 'x',
    })

    for (const list of [byHand, canonical, unknownCategory, noAdapter]) {
      await expect(refreshSourceCopy(harness.db, list, deps(), REFRESHED), list.title).rejects.toBeInstanceOf(
        SourceCopyUnavailableError,
      )
    }
  })

  it('never leaves old and new rows side by side when a write fails part-way, and a repeat finishes the job', async () => {
    const list = await fetchList()
    upstream = { items: [{ title: 'New one', externalRef: 'n1' }, { title: 'New two', externalRef: 'n2' }] }
    const userBefore = await userOwned(list.id)

    // The desktop driver has no transactions, so a failure can land between any two writes.
    const db = harness.db
    const failing = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (property !== 'insert') return typeof value === 'function' ? value.bind(target) : value
        return (table: unknown) => {
          if (table === listSnapshots) throw new Error('disk full')
          return target.insert(table as typeof listSnapshots)
        }
      },
    })

    await expect(refreshSourceCopy(failing, list, deps(), REFRESHED)).rejects.toThrow('disk full')

    expect(await findListSnapshot(db, userId, list.id)).toEqual([])
    expect(await userOwned(list.id)).toEqual(userBefore)

    await refreshSourceCopy(db, list, deps(), REFRESHED)

    expect((await snapshotRows(list)).map((row) => row.title)).toEqual(['New one', 'New two'])
  })

  describe('dropping a copy (task 12.3)', () => {
    it('removes the copy and its date, and nothing the user owns', async () => {
      const list = await fetchList()
      await updateList(harness.db, userId, list.id, { title: 'Mine' })
      const before = await userOwned(list.id)

      await dropSourceCopy(harness.db, (await findList(harness.db, userId, list.id))!)

      expect(await findListSnapshot(harness.db, userId, list.id)).toEqual([])
      expect(await findList(harness.db, userId, list.id)).toMatchObject({
        arrivedTitle: null,
        arrivedDescription: null,
        arrivedStatus: null,
        snapshotFetchedAt: null,
      })
      expect(await userOwned(list.id)).toEqual({
        ...before,
        list: { ...before.list, arrivedTitle: null, arrivedDescription: null },
      })
    })
  })

  describe('refreshing, or dropping a copy that is overdue and cannot be refreshed (task 12.3)', () => {
    const DAY = 24 * 60 * 60 * 1000
    const after = (days: number) => new Date(FETCHED.getTime() + days * DAY)

    it('refreshes a copy when the source answers, whatever its age', async () => {
      const list = await fetchList()
      upstream = { items: [{ title: 'Fresh', externalRef: 'f1' }] }

      const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(40))

      expect(result).toEqual({ outcome: 'refreshed', items: 1 })
      expect((await snapshotRows(list)).map((row) => row.title)).toEqual(['Fresh'])
      expect((await findList(harness.db, userId, list.id))!.snapshotFetchedAt).toEqual(after(40))
    })

    it('keeps a copy that is still in time when the source cannot be reached', async () => {
      const list = await fetchList()
      const before = await snapshotRows(list)
      expand.mockRejectedValueOnce(new Error('offline'))

      const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(29))

      expect(result).toMatchObject({ outcome: 'kept', error: expect.objectContaining({ message: 'offline' }) })
      expect(await snapshotRows(list)).toEqual(before)
      expect((await findList(harness.db, userId, list.id))!.snapshotFetchedAt).toEqual(FETCHED)
    })

    it('drops a copy that is past its limit when the source cannot be reached, leaving the user\u2019s list alone', async () => {
      const list = await fetchList()
      const before = await userOwned(list.id)
      expand.mockRejectedValueOnce(new Error('offline'))

      const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(31))

      expect(result).toMatchObject({ outcome: 'dropped', error: expect.objectContaining({ message: 'offline' }) })
      expect(await findListSnapshot(harness.db, userId, list.id)).toEqual([])
      expect(await findList(harness.db, userId, list.id)).toMatchObject({ arrivedTitle: null, snapshotFetchedAt: null })
      expect(await userOwned(list.id)).toEqual({ ...before, list: { ...before.list, arrivedTitle: null } })
    })

    it('counts a copy as overdue on the day of its limit, not the day after', async () => {
      const onTheDay = await fetchList('On the day')
      const justBefore = await fetchList('Just before')
      await harness.db.update(lists).set({ snapshotFetchedAt: FETCHED }).run()
      expand.mockRejectedValue(new Error('offline'))

      expect(await refreshOrDropSourceCopy(harness.db, justBefore, deps(), new Date(after(30).getTime() - 1))).toMatchObject({
        outcome: 'kept',
      })
      expect(await refreshOrDropSourceCopy(harness.db, onTheDay, deps(), after(30))).toMatchObject({
        outcome: 'dropped',
      })
    })

    it('drops an overdue copy whose source now expands to nothing, since there is nothing to refresh to', async () => {
      const list = await fetchList()
      upstream = { items: [] }

      const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(31))

      expect(result).toMatchObject({ outcome: 'dropped', error: expect.any(SourceCopyEmptyError) })
    })

    it('never drops the copy of a category whose source sets no limit', async () => {
      const unlimited = createMediaTypeRegistry([
        {
          key: 'youtube',
          label: 'YouTube',
          sortOrder: 10,
          defaultDurationMinutes: 45,
          adapter: { isAvailable: () => true, search: async () => [], expand },
        },
      ])
      const list = await fetchList()
      expand.mockRejectedValueOnce(new Error('offline'))

      const result = await refreshOrDropSourceCopy(harness.db, list, { mediaTypes: unlimited.list() }, after(3650))

      expect(result).toMatchObject({ outcome: 'kept' })
      expect(await findListSnapshot(harness.db, userId, list.id)).toHaveLength(3)
    })

    describe('a fetched list whose copy is gone', () => {
      async function droppedList(): Promise<List> {
        const list = await fetchList()
        await updateList(harness.db, userId, list.id, { title: 'Mine', description: 'My notes', status: 'complete' })
        await dropSourceCopy(harness.db, (await findList(harness.db, userId, list.id))!)
        expand.mockClear()
        return (await findList(harness.db, userId, list.id))!
      }

      it('gets a new copy as soon as its source answers', async () => {
        const list = await droppedList()
        const before = await userOwned(list.id)

        const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(45))

        expect(result).toEqual({ outcome: 'created', items: 3 })
        expect((await snapshotRows(list)).map((row) => row.title)).toEqual(['Episode 1', 'Episode 2', 'Episode 3'])
        const after45 = (await findList(harness.db, userId, list.id))!
        expect(after45.snapshotFetchedAt).toEqual(after(45))
        // The list has no title of the source's to keep, so the copy holds the list as it stands now.
        expect(after45).toMatchObject({
          arrivedTitle: 'Mine',
          arrivedDescription: 'My notes',
          arrivedStatus: 'ongoing',
        })
        expect(await userOwned(list.id)).toEqual({
          ...before,
          list: { ...before.list, arrivedTitle: 'Mine', arrivedDescription: 'My notes' },
        })
      })

      it('keeps the list\u2019s own status as the copy\u2019s when the source has none', async () => {
        const list = await droppedList()
        upstream = { items: [{ title: 'Episode 1', externalRef: 'v1' }] }

        await refreshOrDropSourceCopy(harness.db, list, deps(), after(45))

        expect((await findList(harness.db, userId, list.id))!.arrivedStatus).toBe('complete')
      })

      it('is left as it is, and tried again next time, while its source cannot be reached', async () => {
        const list = await droppedList()
        expand.mockRejectedValueOnce(new Error('offline'))

        const result = await refreshOrDropSourceCopy(harness.db, list, deps(), after(45))

        expect(result).toMatchObject({ outcome: 'missing', error: expect.objectContaining({ message: 'offline' }) })
        expect(await findListSnapshot(harness.db, userId, list.id)).toEqual([])
        expect((await findList(harness.db, userId, list.id))!.snapshotFetchedAt).toBeNull()
      })

      it('is not given a copy when its category sets no limit: nothing there ever has to be dropped', async () => {
        const unlimited = createMediaTypeRegistry([
          {
            key: 'youtube',
            label: 'YouTube',
            sortOrder: 10,
            defaultDurationMinutes: 45,
            adapter: { isAvailable: () => true, search: async () => [], expand },
          },
        ])
        const list = await droppedList()

        const result = await refreshOrDropSourceCopy(harness.db, list, { mediaTypes: unlimited.list() }, after(45))

        expect(result).toEqual({ outcome: 'none' })
        expect(expand).not.toHaveBeenCalled()
      })

      it('is not given a copy when it was never fetched from a source, and the source is not asked', async () => {
        const byHand = await createList(harness.db, userId, { title: 'By hand', mediaType: 'youtube' })
        const curated = await createList(harness.db, userId, {
          title: 'Curated',
          mediaType: 'youtube',
          source: 'canonical',
          externalRef: 'canonical:youtube/curated.yaml',
        })

        for (const list of [byHand, curated]) {
          expect(await refreshOrDropSourceCopy(harness.db, list, deps(), after(45)), list.title).toEqual({
            outcome: 'none',
          })
        }
        expect(expand).not.toHaveBeenCalled()
      })
    })
  })
})
