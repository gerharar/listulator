import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { createList, createListItem, reorderListItems, setListItemConsumed } from '../catalog/repository.js'
import { loadRankingInputs } from './rankingInputs.js'

/**
 * What every suggestion button ranks: the reader's lists with their stats, and each list's unconsumed items in
 * order (review 2026-10-04: it was two queries per list, written out on the server and again on the desktop).
 */
describe('loadRankingInputs', () => {
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

  async function listWith(userId: string, title: string, items: string[]) {
    const list = await createList(harness.db, userId, { title, mediaType: 'movie' })
    const created = []
    for (const item of items) {
      created.push((await createListItem(harness.db, userId, list.id, { title: item, timeToConsumeMinutes: 90 }))!)
    }
    return { list, items: created }
  }

  it('gives each list its unconsumed items in list order, and the first of them as the next one', async () => {
    const { list, items } = await listWith(ownerId, 'Films', ['A', 'B', 'C', 'D'])
    await setListItemConsumed(harness.db, ownerId, list.id, items[0]!.id, true)
    await reorderListItems(harness.db, ownerId, list.id, [items[0]!.id, items[3]!.id, items[1]!.id, items[2]!.id])

    const inputs = await loadRankingInputs(harness.db, ownerId)

    expect(inputs.unconsumed.get(list.id)!.map((item) => item.title)).toEqual(['D', 'B', 'C'])
    expect(inputs.nextItems.get(list.id)?.title).toBe('D')
    expect(inputs.candidates.map((candidate) => candidate.id)).toEqual([list.id])
  })

  it('keeps a list with nothing left in the candidates, with no items and no next one', async () => {
    const { list, items } = await listWith(ownerId, 'Done', ['Only'])
    await setListItemConsumed(harness.db, ownerId, list.id, items[0]!.id, true)
    const empty = await createList(harness.db, ownerId, { title: 'Empty', mediaType: 'movie' })

    const inputs = await loadRankingInputs(harness.db, ownerId)

    expect(inputs.unconsumed.get(list.id)).toEqual([])
    expect(inputs.unconsumed.get(empty.id)).toEqual([])
    expect(inputs.nextItems.get(list.id)).toBeUndefined()
    expect(inputs.candidates).toHaveLength(2)
  })

  it('reads only the reader’s own lists and items', async () => {
    await listWith(strangerId, 'Theirs', ['X'])
    const { list } = await listWith(ownerId, 'Mine', ['Y'])

    const inputs = await loadRankingInputs(harness.db, ownerId)

    expect(inputs.candidates.map((candidate) => candidate.title)).toEqual(['Mine'])
    expect([...inputs.unconsumed.keys()]).toEqual([list.id])
  })
})
