import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'

/** Update markers (10.17): what arrived with the last sync, and Mark all seen. */
describe('update markers', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as object } : {}) })

  const makeList = async (title = 'Show') =>
    (await send('POST', '/lists', { title, mediaType: 'tv' })).json()

  const importItems = (listId: string, titles: string[], extra: object = {}) =>
    send('POST', `/lists/${listId}/items/import`, {
      items: titles.map((title) => ({ title })),
      ...extra,
    })

  const detail = async (listId: string) => (await send('GET', `/lists/${listId}`)).json()

  it('flags items brought in by a refresh, and only those', async () => {
    const list = await makeList()
    await importItems(list.id, ['Old one'])
    await importItems(list.id, ['New one', 'New two'], { arrived: true })

    const { items, stats } = await detail(list.id)

    expect(items.map((i: { title: string; isNew: boolean }) => [i.title, i.isNew])).toEqual([
      ['Old one', false],
      ['New one', true],
      ['New two', true],
    ])
    expect(stats.newItems).toBe(2)
  })

  it('does not flag hand-added items or ordinary imports', async () => {
    const list = await makeList()
    await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 30 })
    await importItems(list.id, ['Imported'])

    const { items, stats } = await detail(list.id)

    expect(items.every((i: { isNew: boolean }) => i.isNew === false)).toBe(true)
    expect(stats.newItems).toBe(0)
  })

  it('reports each list its own new count in the overview', async () => {
    const a = await makeList('A')
    const b = await makeList('B')
    await importItems(a.id, ['x', 'y', 'z'], { arrived: true })
    await importItems(b.id, ['q'])

    const overview: { id: string; stats: { newItems: number } }[] = (await send('GET', '/lists')).json()

    expect(overview.find((l) => l.id === a.id)?.stats.newItems).toBe(3)
    expect(overview.find((l) => l.id === b.id)?.stats.newItems).toBe(0)
  })

  describe('Mark all seen', () => {
    it('clears every marker on the list and says how many it cleared', async () => {
      const list = await makeList()
      await importItems(list.id, ['x', 'y'], { arrived: true })

      const seen = await send('POST', `/lists/${list.id}/seen`)

      expect(seen.statusCode).toBe(200)
      expect(seen.json()).toEqual({ cleared: 2 })
      const after = await detail(list.id)
      expect(after.stats.newItems).toBe(0)
      expect(after.items.every((i: { isNew: boolean }) => i.isNew === false)).toBe(true)
    })

    it('leaves other lists alone', async () => {
      const a = await makeList('A')
      const b = await makeList('B')
      await importItems(a.id, ['x'], { arrived: true })
      await importItems(b.id, ['y'], { arrived: true })

      await send('POST', `/lists/${a.id}/seen`)

      expect((await detail(b.id)).stats.newItems).toBe(1)
    })

    it('clears nothing on a list with nothing new', async () => {
      const list = await makeList()

      expect((await send('POST', `/lists/${list.id}/seen`)).json()).toEqual({ cleared: 0 })
    })

    it('is 404 for a list that does not exist', async () => {
      expect((await send('POST', '/lists/nope/seen')).statusCode).toBe(404)
    })
  })

  it('brings the marker back when a removed new item is restored', async () => {
    const list = await makeList()
    const [created] = (await importItems(list.id, ['x'], { arrived: true })).json()

    const deleted = await send('DELETE', `/lists/${list.id}/items/${created.id}`)
    await send('POST', `/lists/${list.id}/items/restore`, deleted.json().restore)

    expect((await detail(list.id)).items[0].isNew).toBe(true)
  })
})
