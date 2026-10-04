import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dismissedItems, listGroups, listItems, listSnapshots, lists, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createListItems } from './bulkItems.js'
import { createListGroup, deleteListGroup, findListGroups, GroupNameError, seedGroupOrder } from './groups.js'
import {
  captureItemSet,
  ListExistsError,
  restoreItemSet,
  restoreList,
  restoreListGroup,
  restoreListItem,
} from './restore.js'
import {
  createList,
  createListItem,
  createListSnapshot,
  deleteList,
  deleteListItem,
  findList,
  findListItems,
  findListSnapshot,
  findListWithStats,
  setListItemConsumed,
} from './repository.js'

/**
 * Undo (D2, task 10.19a): every destructive call returns what it removed, and a
 * restore call puts it back — same ids, same positions, same done state. The
 * client keeps the payload only in the Undo toast's memory.
 */
describe('restoring what was deleted', () => {
  let harness: TestApp
  let ownerId: string
  let strangerId: string
  let listId: string

  beforeEach(async () => {
    harness = createTestApp()
    await harness.app.ready()

    ownerId = harness.db.select().from(users).get()!.id
    strangerId = harness.db.insert(users).values({}).returning().get().id
    listId = (await createList(harness.db, ownerId, { title: 'Show', mediaType: 'tv' })).id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  async function addItem(title: string, extra: Record<string, unknown> = {}) {
    return (await createListItem(harness.db, ownerId, listId, {
      title,
      timeToConsumeMinutes: 30,
      ...extra,
    }))!
  }

  const titles = async () => (await findListItems(harness.db, ownerId, listId))!.map((i) => i.title)

  describe('an item', () => {
    it('returns the item it removed, with its position, done state and dismissal', async () => {
      const item = await addItem('Doomed', { externalRef: 'tmdb:1', year: 1999, group: 'S1' })
      await setListItemConsumed(harness.db, ownerId, listId, item.id, true)

      const restore = await deleteListItem(harness.db, ownerId, listId, item.id)

      expect(restore!.item).toMatchObject({
        id: item.id,
        title: 'Doomed',
        orderIndex: item.orderIndex,
        externalRef: 'tmdb:1',
        year: 1999,
        group: 'S1',
      })
      expect(restore!.item.consumedAt).toEqual(expect.any(String))
      expect(restore!.dismissalId).toEqual(expect.any(String))
      expect(harness.db.select().from(dismissedItems).all()).toHaveLength(1)
    })

    it('says there was nothing to delete for an unknown item or someone else’s list', async () => {
      const item = await addItem('A')

      expect(await deleteListItem(harness.db, ownerId, listId, 'nope')).toBeUndefined()
      expect(await deleteListItem(harness.db, strangerId, listId, item.id)).toBeUndefined()
    })

    it('puts the item back with its id, its position index and its done state', async () => {
      await addItem('First')
      const middle = await addItem('Middle', { timeToConsumeMinutes: 45 })
      await addItem('Last')
      await setListItemConsumed(harness.db, ownerId, listId, middle.id, true)
      const restore = (await deleteListItem(harness.db, ownerId, listId, middle.id))!

      const back = await restoreListItem(harness.db, ownerId, listId, restore)

      expect(back).toMatchObject({ id: middle.id, title: 'Middle', orderIndex: middle.orderIndex, timeToConsumeMinutes: 45 })
      expect(back!.consumedAt).toEqual(middle.consumedAt ?? expect.any(Date))
      expect(await titles()).toEqual(['First', 'Middle', 'Last'])
    })

    it('restores to the same index even after something was added at the end meanwhile', async () => {
      const first = await addItem('First')
      await addItem('Second')
      const restore = (await deleteListItem(harness.db, ownerId, listId, first.id))!
      await addItem('Newcomer')

      await restoreListItem(harness.db, ownerId, listId, restore)

      // Back at its own index, not glued to whichever neighbour it once had.
      expect(await titles()).toEqual(['First', 'Second', 'Newcomer'])
    })

    it('removes the dismissal the delete made, so a refresh can offer it again', async () => {
      const item = await addItem('Doomed')
      const restore = (await deleteListItem(harness.db, ownerId, listId, item.id))!

      await restoreListItem(harness.db, ownerId, listId, restore)

      expect(harness.db.select().from(dismissedItems).all()).toEqual([])
    })

    it('brings back the group of the item if that group was removed in between', async () => {
      const item = await addItem('E1', { group: 'Season 1' })
      const restore = (await deleteListItem(harness.db, ownerId, listId, item.id))!
      const group = (await findListGroups(harness.db, ownerId, listId))![0]!
      await deleteListGroup(harness.db, ownerId, listId, group.id)

      await restoreListItem(harness.db, ownerId, listId, restore)

      expect((await findListGroups(harness.db, ownerId, listId))!.map((g) => g.name)).toEqual(['Season 1'])
    })

    it('is harmless to restore twice', async () => {
      const item = await addItem('Once')
      const restore = (await deleteListItem(harness.db, ownerId, listId, item.id))!

      await restoreListItem(harness.db, ownerId, listId, restore)
      await restoreListItem(harness.db, ownerId, listId, restore)

      expect(await titles()).toEqual(['Once'])
    })

    it('will not restore into a list that is not yours', async () => {
      const item = await addItem('A')
      const restore = (await deleteListItem(harness.db, ownerId, listId, item.id))!

      expect(await restoreListItem(harness.db, strangerId, listId, restore)).toBeUndefined()
      expect(await titles()).toEqual([])
    })
  })

  describe('a group', () => {
    it('returns the group it removed', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'Empty'))!

      const restore = await deleteListGroup(harness.db, ownerId, listId, group.id)

      expect(restore!.group).toMatchObject({ id: group.id, name: 'Empty', orderIndex: 0 })
    })

    it('puts it back at its own position among the others', async () => {
      await createListGroup(harness.db, ownerId, listId, 'A')
      const b = (await createListGroup(harness.db, ownerId, listId, 'B'))!
      await createListGroup(harness.db, ownerId, listId, 'C')
      const restore = (await deleteListGroup(harness.db, ownerId, listId, b.id))!

      const back = await restoreListGroup(harness.db, ownerId, listId, restore)

      expect(back).toMatchObject({ id: b.id, name: 'B', orderIndex: 1 })
      const groups = (await findListGroups(harness.db, ownerId, listId))!
      expect(groups.map((g) => [g.name, g.orderIndex])).toEqual([['A', 0], ['B', 1], ['C', 2]])
    })

    it('refuses to come back under a name that has been taken since', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'Taken'))!
      const restore = (await deleteListGroup(harness.db, ownerId, listId, group.id))!
      await createListGroup(harness.db, ownerId, listId, 'Taken')

      await expect(restoreListGroup(harness.db, ownerId, listId, restore)).rejects.toThrow(GroupNameError)
    })

    it('is harmless to restore twice', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'Once'))!
      const restore = (await deleteListGroup(harness.db, ownerId, listId, group.id))!

      await restoreListGroup(harness.db, ownerId, listId, restore)
      await restoreListGroup(harness.db, ownerId, listId, restore)

      expect((await findListGroups(harness.db, ownerId, listId))!).toHaveLength(1)
    })

    it('brings back a group deleted with more items than one statement can bind', async () => {
      // Review 2026-10-04: one insert for all of them, 16 values a row, failed above 2,047 items with "too many
      // SQL variables", after the delete had already happened: the group came back empty and the items were lost.
      await createListItems(
        harness.db,
        ownerId,
        listId,
        Array.from({ length: 2100 }, (_, index) => ({
          title: `E${index}`,
          timeToConsumeMinutes: 30,
          timeToConsumeIsEstimated: false,
          group: 'Huge',
          source: 'import' as const,
        })),
      )
      await seedGroupOrder(harness.db, listId)
      const group = (await findListGroups(harness.db, ownerId, listId))![0]!
      const restore = (await deleteListGroup(harness.db, ownerId, listId, group.id, { withItems: true }))!

      await restoreListGroup(harness.db, ownerId, listId, restore)

      const items = (await findListItems(harness.db, ownerId, listId))!
      expect(items).toHaveLength(2100)
      expect(items.every((item) => item.group === 'Huge')).toBe(true)
    })

    it('deletes, and brings back, a group whose items need more dismissals than one statement can bind', async () => {
      // The same review: the delete wrote one dismissal per item in a single insert, after removing the items; above
      // ~6,500 it failed there, with the items gone and no Undo handed back.
      await createListItems(
        harness.db,
        ownerId,
        listId,
        Array.from({ length: 7000 }, (_, index) => ({
          title: `E${index}`,
          timeToConsumeMinutes: 30,
          timeToConsumeIsEstimated: false,
          externalRef: `tmdb:${index}`,
          group: 'Huge',
          source: 'import' as const,
        })),
      )
      await seedGroupOrder(harness.db, listId)
      const group = (await findListGroups(harness.db, ownerId, listId))![0]!

      const restore = (await deleteListGroup(harness.db, ownerId, listId, group.id, { withItems: true }))!

      expect(restore.dismissalIds).toHaveLength(7000)
      await restoreListGroup(harness.db, ownerId, listId, restore)
      expect((await findListItems(harness.db, ownerId, listId))!).toHaveLength(7000)
      expect(harness.db.select().from(dismissedItems).all()).toEqual([])
    })
  })

  describe('a whole list', () => {
    async function buildRichList() {
      const rich = await createList(harness.db, ownerId, {
        title: 'Rich',
        description: 'A blurb',
        mediaType: 'tv',
        source: 'file',
        status: 'ongoing',
        sourceYaml: 'title: Rich\n',
        arrivedTitle: 'Rich',
        arrivedDescription: 'A blurb',
        arrivedStatus: 'ongoing',
        snapshotFetchedAt: new Date('2026-09-01T10:00:00.000Z'),
      })
      const a = (await createListItem(harness.db, ownerId, rich.id, { title: 'A', timeToConsumeMinutes: 20, group: 'S1', year: 2001, tags: ['x'], notes: 'n' }))!
      await createListItem(harness.db, ownerId, rich.id, { title: 'B', timeToConsumeMinutes: 25, group: 'S1' })
      await createListItem(harness.db, ownerId, rich.id, { title: 'C', timeToConsumeMinutes: 30 })
      await setListItemConsumed(harness.db, ownerId, rich.id, a.id, true)
      await createListGroup(harness.db, ownerId, rich.id, 'Empty group')
      const items = (await findListItems(harness.db, ownerId, rich.id))!
      await createListSnapshot(harness.db, rich.id, items)
      const gone = items[2]!
      await deleteListItem(harness.db, ownerId, rich.id, gone.id)

      return rich
    }

    it('returns everything the list held', async () => {
      const rich = await buildRichList()

      const restore = (await deleteList(harness.db, ownerId, rich.id))!

      expect(restore.list).toMatchObject({ id: rich.id, title: 'Rich', sourceYaml: 'title: Rich\n', status: 'ongoing', arrivedTitle: 'Rich' })
      expect(restore.items.map((i) => i.title)).toEqual(['A', 'B'])
      expect(restore.groups.map((g) => g.name)).toEqual(['S1', 'Empty group'])
      expect(restore.snapshot).toHaveLength(3)
      expect(restore.dismissals).toHaveLength(1)
    })

    it('brings the list back intact: same ids, items, done marks, groups, snapshot, dismissals and source text', async () => {
      const rich = await buildRichList()
      const before = (await findListItems(harness.db, ownerId, rich.id))!
      const beforeStats = (await findListWithStats(harness.db, ownerId, rich.id))!.stats
      const snapshotBefore = await findListSnapshot(harness.db, ownerId, rich.id)
      const restore = (await deleteList(harness.db, ownerId, rich.id))!
      expect(await findList(harness.db, ownerId, rich.id)).toBeUndefined()

      await restoreList(harness.db, ownerId, restore)

      const list = (await findListWithStats(harness.db, ownerId, rich.id))!
      expect(list).toMatchObject({ id: rich.id, title: 'Rich', description: 'A blurb', status: 'ongoing', sourceYaml: 'title: Rich\n', source: 'file', userId: ownerId })
      expect(list.snapshotFetchedAt).toEqual(new Date('2026-09-01T10:00:00.000Z'))
      expect(list.stats).toEqual(beforeStats)
      const after = (await findListItems(harness.db, ownerId, rich.id))!
      expect(after.map((i) => [i.id, i.title, i.orderIndex, i.group, i.year, i.tags, i.notes, i.consumedAt])).toEqual(
        before.map((i) => [i.id, i.title, i.orderIndex, i.group, i.year, i.tags, i.notes, i.consumedAt]),
      )
      expect((await findListGroups(harness.db, ownerId, rich.id))!.map((g) => [g.name, g.orderIndex])).toEqual([['S1', 0], ['Empty group', 1]])
      expect(await findListSnapshot(harness.db, ownerId, rich.id)).toEqual(snapshotBefore)
      expect(harness.db.select().from(dismissedItems).where(eq(dismissedItems.listId, rich.id)).all()).toHaveLength(1)
    })

    it('says there was nothing to delete for a list that is not yours', async () => {
      const rich = await buildRichList()

      expect(await deleteList(harness.db, strangerId, rich.id)).toBeUndefined()
    })

    it('restores under the current user, whoever the payload names', async () => {
      const rich = await buildRichList()
      const restore = (await deleteList(harness.db, ownerId, rich.id))!

      await restoreList(harness.db, strangerId, { ...restore, list: { ...restore.list, userId: ownerId } as never })

      expect((await findList(harness.db, strangerId, rich.id))!.userId).toBe(strangerId)
      expect(await findList(harness.db, ownerId, rich.id)).toBeUndefined()
    })

    it('refuses to overwrite a list that exists', async () => {
      const rich = await buildRichList()
      const restore = (await deleteList(harness.db, ownerId, rich.id))!
      await restoreList(harness.db, ownerId, restore)

      await expect(restoreList(harness.db, ownerId, restore)).rejects.toThrow(ListExistsError)
      expect(harness.db.select().from(lists).where(eq(lists.id, rich.id)).all()).toHaveLength(1)
      expect(harness.db.select().from(listItems).where(eq(listItems.listId, rich.id)).all()).toHaveLength(2)
      expect(harness.db.select().from(listGroups).where(eq(listGroups.listId, rich.id)).orderBy(asc(listGroups.orderIndex)).all()).toHaveLength(2)
      expect(harness.db.select().from(listSnapshots).where(eq(listSnapshots.listId, rich.id)).all()).toHaveLength(3)
    })
  })

  describe('a whole item set (what Reset will undo)', () => {
    it('puts back exactly the captured items and dismissals, replacing whatever is there now', async () => {
      const a = await addItem('A', { group: 'S1' })
      const b = await addItem('B', { group: 'S1' })
      await setListItemConsumed(harness.db, ownerId, listId, b.id, true)
      const removed = await addItem('Removed')
      await deleteListItem(harness.db, ownerId, listId, removed.id)
      const before = (await findListItems(harness.db, ownerId, listId))!
      const captured = (await captureItemSet(harness.db, ownerId, listId))!

      // Something wipes and refills the list, as a Reset would.
      await deleteListItem(harness.db, ownerId, listId, a.id)
      await deleteListItem(harness.db, ownerId, listId, b.id)
      await addItem('Different')
      harness.db.delete(dismissedItems).run()

      await restoreItemSet(harness.db, ownerId, listId, captured)

      const after = (await findListItems(harness.db, ownerId, listId))!
      expect(after.map((i) => [i.id, i.title, i.orderIndex, i.group, i.consumedAt])).toEqual(
        before.map((i) => [i.id, i.title, i.orderIndex, i.group, i.consumedAt]),
      )
      expect(harness.db.select().from(dismissedItems).all()).toHaveLength(1)
      expect((await findListGroups(harness.db, ownerId, listId))!.map((g) => g.name)).toEqual(['S1'])
    })

    it('touches nothing in a list that is not yours', async () => {
      await addItem('A')
      const captured = (await captureItemSet(harness.db, ownerId, listId))!

      expect(await restoreItemSet(harness.db, strangerId, listId, captured)).toBeUndefined()
      expect(await captureItemSet(harness.db, strangerId, listId)).toBeUndefined()
      expect(await titles()).toEqual(['A'])
    })
  })
})
