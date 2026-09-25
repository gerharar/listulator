import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listGroups, listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import {
  createListGroup,
  deleteListGroup,
  findListGroups,
  GroupNameError,
  GroupNotEmptyError,
  GroupReorderMismatchError,
  renameListGroup,
  reorderListGroups,
  seedGroupOrder,
} from './groups.js'
import { createList, createListItem, findListItems } from './repository.js'

/** Integration tests against a temp SQLite file (task 10.16, D3). */
describe('list groups', () => {
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

  async function addItem(title: string, group?: string, year?: number) {
    return (await createListItem(harness.db, ownerId, listId, {
      title,
      timeToConsumeMinutes: 30,
      ...(group !== undefined ? { group } : {}),
      ...(year !== undefined ? { year } : {}),
    }))!
  }

  const names = async () => (await findListGroups(harness.db, ownerId, listId))!.map((g) => g.name)
  const order = async () => (await findListItems(harness.db, ownerId, listId))!.map((i) => i.title)

  describe('creating', () => {
    it('makes an empty group, and it survives with nothing in it', async () => {
      const group = await createListGroup(harness.db, ownerId, listId, 'Season 1')

      expect(group).toMatchObject({ name: 'Season 1', orderIndex: 0, listId })
      expect(await names()).toEqual(['Season 1'])
      expect(await findListItems(harness.db, ownerId, listId)).toEqual([])
    })

    it('appends each new group to the end', async () => {
      await createListGroup(harness.db, ownerId, listId, 'A')
      await createListGroup(harness.db, ownerId, listId, 'B')
      await createListGroup(harness.db, ownerId, listId, 'C')

      expect((await findListGroups(harness.db, ownerId, listId))!.map((g) => g.orderIndex)).toEqual([0, 1, 2])
      expect(await names()).toEqual(['A', 'B', 'C'])
    })

    it('trims the name, and refuses an empty one', async () => {
      expect((await createListGroup(harness.db, ownerId, listId, '  Padded  '))!.name).toBe('Padded')
      await expect(createListGroup(harness.db, ownerId, listId, '   ')).rejects.toThrow(GroupNameError)
    })

    it('refuses a name already used in the list, whatever its case', async () => {
      await createListGroup(harness.db, ownerId, listId, 'Season 1')

      await expect(createListGroup(harness.db, ownerId, listId, 'season 1')).rejects.toMatchObject({
        reason: 'duplicate',
      })
    })

    it('lets two lists use the same name', async () => {
      const other = (await createList(harness.db, ownerId, { title: 'Other', mediaType: 'tv' })).id
      await createListGroup(harness.db, ownerId, listId, 'Season 1')

      expect(await createListGroup(harness.db, ownerId, other, 'Season 1')).toBeDefined()
    })

    it("does not touch someone else's list", async () => {
      expect(await createListGroup(harness.db, strangerId, listId, 'X')).toBeUndefined()
      expect(await findListGroups(harness.db, strangerId, listId)).toBeUndefined()
    })
  })

  describe('items and groups', () => {
    it('gives an item’s new group label a group of its own, at the end', async () => {
      await addItem('a', 'Season 1')
      await addItem('b', 'Season 2')

      expect(await names()).toEqual(['Season 1', 'Season 2'])
    })

    it('does not make a group for an ungrouped item', async () => {
      await addItem('a')

      expect(await names()).toEqual([])
    })

    it('puts an item added to a group at the end of that group, keeping it contiguous (BL-003)', async () => {
      await addItem('s1e1', 'Season 1')
      await addItem('s1e2', 'Season 1')
      await addItem('s2e1', 'Season 2')
      await addItem('s2e2', 'Season 2')

      // Like a refresh that finds a new episode in a middle group.
      await addItem('s1e3', 'Season 1')

      expect(await order()).toEqual(['s1e1', 's1e2', 's1e3', 's2e1', 's2e2'])
      expect((await findListItems(harness.db, ownerId, listId))!.map((i) => i.orderIndex)).toEqual([0, 1, 2, 3, 4])
    })

    it('puts an item with no group at the end of the list', async () => {
      await addItem('s1e1', 'Season 1')
      await addItem('s2e1', 'Season 2')

      await addItem('loose')

      expect(await order()).toEqual(['s1e1', 's2e1', 'loose'])
    })

    it('puts the first item of a group with no items yet at the end of the list', async () => {
      await createListGroup(harness.db, ownerId, listId, 'Empty so far')
      await addItem('a', 'Season 1')

      await addItem('b', 'Empty so far')

      expect(await order()).toEqual(['a', 'b'])
    })

    it('honours an explicit position without shifting anything', async () => {
      await addItem('a', 'G')
      const item = await createListItem(harness.db, ownerId, listId, {
        title: 'pinned',
        timeToConsumeMinutes: 30,
        group: 'G',
        orderIndex: 10,
      })

      expect(item!.orderIndex).toBe(10)
    })

    it('reuses an existing group for a label it already has', async () => {
      await addItem('a', 'Season 1')
      await addItem('b', 'Season 1')

      expect(await names()).toEqual(['Season 1'])
    })
  })

  describe('renaming', () => {
    it('renames the group and relabels its items', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'Old'))!
      await addItem('a', 'Old')
      await addItem('b', 'Other')

      const renamed = await renameListGroup(harness.db, ownerId, listId, group.id, 'New')

      expect(renamed!.name).toBe('New')
      expect((await findListItems(harness.db, ownerId, listId))!.map((i) => i.group)).toEqual(['New', 'Other'])
      expect(await names()).toEqual(['New', 'Other'])
    })

    it('refuses a name another group already has', async () => {
      const a = (await createListGroup(harness.db, ownerId, listId, 'A'))!
      await createListGroup(harness.db, ownerId, listId, 'B')

      await expect(renameListGroup(harness.db, ownerId, listId, a.id, 'b')).rejects.toMatchObject({
        reason: 'duplicate',
      })
      expect(await names()).toEqual(['A', 'B'])
    })

    it('allows changing only the case of its own name', async () => {
      const a = (await createListGroup(harness.db, ownerId, listId, 'season 1'))!

      expect((await renameListGroup(harness.db, ownerId, listId, a.id, 'Season 1'))!.name).toBe('Season 1')
    })

    it('says not found for an unknown group, or one in a list that is not yours', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'A'))!

      expect(await renameListGroup(harness.db, ownerId, listId, 'nope', 'X')).toBeUndefined()
      expect(await renameListGroup(harness.db, strangerId, listId, group.id, 'X')).toBeUndefined()
    })
  })

  describe('deleting', () => {
    it('deletes an empty group and closes the gap in the numbering', async () => {
      await createListGroup(harness.db, ownerId, listId, 'A')
      const b = (await createListGroup(harness.db, ownerId, listId, 'B'))!
      await createListGroup(harness.db, ownerId, listId, 'C')

      expect(await deleteListGroup(harness.db, ownerId, listId, b.id)).toMatchObject({ group: { name: 'B' } })

      const groups = (await findListGroups(harness.db, ownerId, listId))!
      expect(groups.map((g) => [g.name, g.orderIndex])).toEqual([['A', 0], ['C', 1]])
    })

    it('refuses a group that still has items', async () => {
      await addItem('a', 'Season 1')
      const group = (await findListGroups(harness.db, ownerId, listId))![0]!

      await expect(deleteListGroup(harness.db, ownerId, listId, group.id)).rejects.toThrow(GroupNotEmptyError)
      expect(await names()).toEqual(['Season 1'])
    })

    it('says not found for an unknown group or someone else’s list', async () => {
      const group = (await createListGroup(harness.db, ownerId, listId, 'A'))!

      expect(await deleteListGroup(harness.db, ownerId, listId, 'nope')).toBeUndefined()
      expect(await deleteListGroup(harness.db, strangerId, listId, group.id)).toBeUndefined()
    })
  })

  describe('reordering', () => {
    it('reorders the groups and moves each group’s items with it', async () => {
      await addItem('a1', 'A')
      await addItem('a2', 'A')
      await addItem('b1', 'B')
      await addItem('c1', 'C')
      const [a, b, c] = (await findListGroups(harness.db, ownerId, listId))!

      await reorderListGroups(harness.db, ownerId, listId, [c!.id, a!.id, b!.id])

      expect(await names()).toEqual(['C', 'A', 'B'])
      expect(await order()).toEqual(['c1', 'a1', 'a2', 'b1'])
      expect((await findListItems(harness.db, ownerId, listId))!.map((i) => i.orderIndex)).toEqual([0, 1, 2, 3])
    })

    it('leaves ungrouped items where they are', async () => {
      await addItem('loose-first')
      await addItem('a1', 'A')
      await addItem('b1', 'B')
      await addItem('loose-last')
      const [a, b] = (await findListGroups(harness.db, ownerId, listId))!

      await reorderListGroups(harness.db, ownerId, listId, [b!.id, a!.id])

      expect(
        (await findListItems(harness.db, ownerId, listId))!.map((i) => [i.title, i.orderIndex]),
      ).toEqual([
        ['loose-first', 0],
        ['b1', 1],
        ['a1', 2],
        ['loose-last', 3],
      ])
    })

    it('keeps the order inside a group', async () => {
      await addItem('a1', 'A')
      await addItem('a2', 'A')
      await addItem('b1', 'B')
      const [a, b] = (await findListGroups(harness.db, ownerId, listId))!

      await reorderListGroups(harness.db, ownerId, listId, [b!.id, a!.id])

      expect(await order()).toEqual(['b1', 'a1', 'a2'])
    })

    it('can order an empty group among the others', async () => {
      const empty = (await createListGroup(harness.db, ownerId, listId, 'Empty'))!
      await addItem('a1', 'A')
      const a = (await findListGroups(harness.db, ownerId, listId))![1]!

      await reorderListGroups(harness.db, ownerId, listId, [a.id, empty.id])

      expect(await names()).toEqual(['A', 'Empty'])
    })

    it('refuses a set that is not exactly the list’s groups', async () => {
      const a = (await createListGroup(harness.db, ownerId, listId, 'A'))!
      await createListGroup(harness.db, ownerId, listId, 'B')

      await expect(reorderListGroups(harness.db, ownerId, listId, [a.id])).rejects.toThrow(
        GroupReorderMismatchError,
      )
      await expect(reorderListGroups(harness.db, ownerId, listId, [a.id, a.id])).rejects.toThrow(
        GroupReorderMismatchError,
      )
    })
  })

  describe('seeding the order at import (from the earliest year)', () => {
    it('orders groups by the earliest year among their items', async () => {
      await addItem('later', 'Later', 2010)
      await addItem('earlier', 'Earlier', 1999)
      await addItem('mid', 'Mid', 2005)

      await seedGroupOrder(harness.db, listId)

      expect(await names()).toEqual(['Earlier', 'Mid', 'Later'])
    })

    it('keeps first-appearance order for groups with the same or no years', async () => {
      await addItem('a', 'A')
      await addItem('b', 'B', 2001)
      await addItem('c', 'C')
      await addItem('d', 'D', 2001)

      await seedGroupOrder(harness.db, listId)

      expect(await names()).toEqual(['B', 'D', 'A', 'C'])
    })

    it('changes no item’s position', async () => {
      await addItem('later', 'Later', 2010)
      await addItem('earlier', 'Earlier', 1999)

      await seedGroupOrder(harness.db, listId)

      expect(await order()).toEqual(['later', 'earlier'])
    })
  })

  it('removes a list’s groups with the list', async () => {
    await createListGroup(harness.db, ownerId, listId, 'A')
    harness.db.delete((await import('../db/schema.js')).lists).where(eq((await import('../db/schema.js')).lists.id, listId)).run()

    expect(harness.db.select().from(listGroups).orderBy(asc(listGroups.orderIndex)).all()).toEqual([])
    expect(harness.db.select().from(listItems).all()).toEqual([])
  })
})
