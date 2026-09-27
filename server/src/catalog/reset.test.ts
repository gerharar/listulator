import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IngestionError } from '../ingestion/http.js'
import { createMediaTypeRegistry, type SearchAdapter } from '../ingestion/mediaTypes.js'
import { listItems, users } from '../db/schema.js'
import { createTestApp, type TestApp } from '../testing/harness.js'
import { resetToSource } from './reset.js'

/** Sort chronologically and Reset to the source (10.18, D4), over HTTP. */

interface Item {
  id: string
  title: string
  group: string | null
  orderIndex: number
  year: number | null
  consumedAt: string | null
  isNew: boolean
  externalRef: string | null
  source: string
  tags: string[] | null
  notes: string | null
  timeToConsumeMinutes: number
  timeToConsumeIsEstimated: boolean
}
interface Detail {
  id: string
  title: string
  description: string | null
  status: string | null
  items: Item[]
  groups: { id: string; name: string; orderIndex: number }[]
}

describe('sort and reset', () => {
  let harness: TestApp

  const upstream = [
    { title: 'Late One', year: 2010, group: 'Arc B', externalRef: 'g:1', tags: ['Film'], notes: 'n1' },
    { title: 'Early One', year: 1999, group: 'Arc A', externalRef: 'g:2' },
    { title: 'Late Two', year: 2012, group: 'Arc B', externalRef: 'g:3' },
    { title: 'Early Two', year: 2001, group: 'Arc A', externalRef: 'g:4', timeToConsumeMinutes: 42 },
    { title: 'Loose', year: 2005, externalRef: 'g:5' },
  ]
  const expand = vi.fn(async () => ({ items: upstream, status: 'ongoing' as const }))
  const adapter: SearchAdapter = {
    isAvailable: () => true,
    search: async () => [],
    expand,
  }

  beforeEach(() => {
    expand.mockClear()
    harness = createTestApp({
      mediaTypes: createMediaTypeRegistry([
        { key: 'game', label: 'Games', sortOrder: 10, defaultDurationMinutes: 600, adapter },
        { key: 'mega', label: 'Mega', sortOrder: 20, defaultDurationMinutes: 120 },
      ]),
    })
  })

  afterEach(async () => {
    await harness.cleanup()
    vi.unstubAllGlobals()
  })

  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as object } : {}) })

  const detail = async (id: string): Promise<Detail> => (await send('GET', `/lists/${id}`)).json()

  /** What a person sees, without ids or timestamps: comparable between two lists. */
  const shape = (d: Detail) => ({
    title: d.title,
    description: d.description,
    status: d.status,
    groups: d.groups.map((g) => [g.name, g.orderIndex]),
    items: d.items.map((i) => ({
      title: i.title,
      group: i.group,
      orderIndex: i.orderIndex,
      year: i.year,
      externalRef: i.externalRef,
      tags: i.tags,
      notes: i.notes,
      minutes: i.timeToConsumeMinutes,
      estimated: i.timeToConsumeIsEstimated,
      source: i.source,
      consumedAt: i.consumedAt,
      isNew: i.isNew,
    })),
  })

  /** Everything that must come back exactly on Undo, ids included. */
  const exact = (d: Detail) => ({
    title: d.title,
    description: d.description,
    status: d.status,
    groups: d.groups.map((g) => [g.id, g.name, g.orderIndex]),
    items: d.items.map((i) => ({ ...i, updatedAt: undefined })),
  })

  async function apiList(): Promise<Detail> {
    const created = await send('POST', '/lists/from-source', {
      mediaType: 'game',
      externalRef: 'franchise:1',
      title: 'A franchise',
    })
    expect(created.statusCode).toBe(201)
    return detail(created.json().id)
  }

  const byTitle = (d: Detail, title: string) => d.items.find((i) => i.title === title)!

  describe('Reset the order (back to the order the source has)', () => {
    const titles = async (id: string) => (await detail(id)).items.map((i) => i.title)

    it('puts the source order back where the year sort would not: blocks by source position, insides too', async () => {
      const list = await apiList()
      await send('POST', `/lists/${list.id}/sort`) // by year: Arc A, Loose, Arc B
      expect(await titles(list.id)).toEqual(['Early One', 'Early Two', 'Loose', 'Late One', 'Late Two'])

      const reset = await send('POST', `/lists/${list.id}/reset-order`)

      expect(reset.statusCode).toBe(200)
      // The source lists Late One (Arc B) first, then Early One (Arc A), then Loose.
      expect(await titles(list.id)).toEqual(['Late One', 'Late Two', 'Early One', 'Early Two', 'Loose'])
      expect((await detail(list.id)).groups.map((g) => g.name)).toEqual(['Arc B', 'Arc A'])
    })

    it('puts a hand-shuffled group back in the source order', async () => {
      const list = await apiList()
      const arrived = await titles(list.id)
      const armed = [...(await detail(list.id)).items].reverse().map((i) => i.id)
      await send('PUT', `/lists/${list.id}/items/order`, { itemIds: armed })
      expect(await titles(list.id)).not.toEqual(arrived)

      await send('POST', `/lists/${list.id}/reset-order`)

      const after = (await detail(list.id)).items
      expect(after.filter((i) => i.group === 'Arc A').map((i) => i.title)).toEqual(['Early One', 'Early Two'])
      expect(after.filter((i) => i.group === 'Arc B').map((i) => i.title)).toEqual(['Late One', 'Late Two'])
    })

    it('touches nothing but the order: ticks, hand-added items and groups stay; the added item goes last', async () => {
      const list = await apiList()
      await send('PUT', `/lists/${list.id}/items/${byTitle(list, 'Late One').id}/consumed`, { consumed: true })
      await send('POST', `/lists/${list.id}/items/import`, { source: 'manual', items: [{ title: 'Mine', year: 1980 }] })
      await send('POST', `/lists/${list.id}/sort`)
      const before = await detail(list.id)

      await send('POST', `/lists/${list.id}/reset-order`)
      const after = await detail(list.id)

      expect(after.items.map((i) => i.id).sort()).toEqual(before.items.map((i) => i.id).sort())
      expect(after.items.at(-1)!.title).toBe('Mine')
      expect(after.items.find((i) => i.title === 'Late One')!.consumedAt).not.toBeNull()
      expect(after.groups.map((g) => g.name).sort()).toEqual(['Arc A', 'Arc B'])
      expect(after.title).toBe(before.title)
    })

    it('hands back what it needs for Undo, and Undo puts the exact order back', async () => {
      const list = await apiList()
      await send('POST', `/lists/${list.id}/sort`)
      const before = await detail(list.id)

      const reset = await send('POST', `/lists/${list.id}/reset-order`)
      expect(await titles(list.id)).not.toEqual(before.items.map((i) => i.title))
      const undone = await send('PUT', `/lists/${list.id}/order/restore`, reset.json().restore)

      expect(undone.statusCode).toBe(200)
      expect(exact(await detail(list.id))).toEqual(exact(before))
    })

    it('is refused for a list with no source, and 404 for one that is not there', async () => {
      const manual = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()

      const refused = await send('POST', `/lists/${manual.id}/reset-order`)
      expect(refused.statusCode).toBe(409)
      expect(refused.json().code).toBe('reset.unavailable')
      expect((await send('POST', '/lists/nope/reset-order')).statusCode).toBe(404)
    })
  })

  describe('Sort chronologically', () => {
    it('orders loose items by year, and puts items with no year last, keeping their order', async () => {
      const list = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()
      await send('POST', `/lists/${list.id}/items/import`, {
        source: 'manual',
        items: [
          { title: 'C', year: 2010 },
          { title: 'Nodate 1' },
          { title: 'A', year: 1990 },
          { title: 'Nodate 2' },
          { title: 'B', year: 2000 },
        ],
      })

      const sorted = await send('POST', `/lists/${list.id}/sort`)

      expect(sorted.statusCode).toBe(200)
      expect((await detail(list.id)).items.map((i) => i.title)).toEqual([
        'A',
        'B',
        'C',
        'Nodate 1',
        'Nodate 2',
      ])
    })

    it('sorts inside each group too, keeping a group a block; no-year items last, ties in their order', async () => {
      const list = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()
      await send('POST', `/lists/${list.id}/items/import`, {
        source: 'manual',
        items: [
          { title: 'Sequel 2', year: 1983, group: 'Original' },
          { title: 'Nodate', group: 'Original' },
          { title: 'Sequel 1', year: 1980, group: 'Original' },
          { title: 'Film', year: 1977, group: 'Original' },
          { title: 'Prequel 3', year: 2005, group: 'Prequels' },
          { title: 'Prequel 1', year: 1999, group: 'Prequels' },
          { title: 'Prequel 2', year: 2002, group: 'Prequels' },
        ],
      })

      await send('POST', `/lists/${list.id}/sort`)

      expect((await detail(list.id)).items.map((i) => i.title)).toEqual([
        'Film',
        'Sequel 1',
        'Sequel 2',
        'Nodate',
        'Prequel 1',
        'Prequel 2',
        'Prequel 3',
      ])
    })

    it('leaves the order inside a group alone when every item has the same year', async () => {
      const list = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()
      await send('POST', `/lists/${list.id}/items/import`, {
        source: 'manual',
        items: [
          { title: 'Z', year: 2000, group: 'G' },
          { title: 'A', year: 2000, group: 'G' },
        ],
      })

      await send('POST', `/lists/${list.id}/sort`)

      expect((await detail(list.id)).items.map((i) => i.title)).toEqual(['Z', 'A'])
    })

    it('moves groups as blocks by their earliest item, and sorts inside them', async () => {
      const list = await apiList()
      // Arc B holds 2010 and 2012, Arc A holds 1999 and 2001, Loose is 2005 on its own.
      // Put it in an order that is wrong on purpose: the reverse of the years.
      await send('PUT', `/lists/${list.id}/items/order`, {
        itemIds: [...list.items].sort((a, b) => b.orderIndex - a.orderIndex).map((i) => i.id),
      })
      await send('POST', `/lists/${list.id}/sort`)
      const after = await detail(list.id)

      // Loose (2005) sits between Arc A (1999) and Arc B (2010) as a unit of its own.
      const units = after.items.map((i) => i.group ?? i.title)
      expect(units.join(',').replace(/Arc A,Arc A/, 'A').replace(/Arc B,Arc B/, 'B')).toBe('A,Loose,B')
      expect(after.groups.map((g) => g.name)).toEqual(['Arc A', 'Arc B'])
      expect(after.groups.map((g) => g.orderIndex)).toEqual([0, 1])
    })

    it('positions a group by its earliest year, not its latest', async () => {
      const list = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()
      await send('POST', `/lists/${list.id}/items/import`, {
        source: 'manual',
        items: [
          { title: 'Middle', year: 2000 },
          { title: 'Saga 1', year: 1990, group: 'Saga' },
          { title: 'Saga 2', year: 2020, group: 'Saga' },
        ],
      })

      await send('POST', `/lists/${list.id}/sort`)

      expect((await detail(list.id)).items.map((i) => i.title)).toEqual(['Saga 1', 'Saga 2', 'Middle'])
    })

    it('puts the group rows in the same order as the blocks, empty ones last', async () => {
      const list = await apiList()
      const [arcA, arcB] = [list.groups.find((g) => g.name === 'Arc A')!, list.groups.find((g) => g.name === 'Arc B')!]
      await send('POST', `/lists/${list.id}/groups`, { name: 'Empty' })
      const withEmpty = await detail(list.id)
      const empty = withEmpty.groups.find((g) => g.name === 'Empty')!
      await send('PUT', `/lists/${list.id}/groups/order`, { groupIds: [empty.id, arcB.id, arcA.id] })

      await send('POST', `/lists/${list.id}/sort`)

      expect((await detail(list.id)).groups.map((g) => [g.name, g.orderIndex])).toEqual([
        ['Arc A', 0],
        ['Arc B', 1],
        ['Empty', 2],
      ])
    })

    it('leaves an empty group last, and touches no done mark, marker or id', async () => {
      const list = await apiList()
      await send('POST', `/lists/${list.id}/groups`, { name: 'Empty' })
      await send('PUT', `/lists/${list.id}/items/${byTitle(list, 'Late One').id}/consumed`, { consumed: true })
      await send('POST', `/lists/${list.id}/items/import`, { items: [{ title: 'Fresh' }], arrived: true })
      const before = await detail(list.id)
      await send('POST', `/lists/${list.id}/sort`)
      const after = await detail(list.id)

      expect(after.groups.map((g) => g.name).at(-1)).toBe('Empty')
      for (const item of before.items) {
        const now = after.items.find((i) => i.id === item.id)!
        expect([now.consumedAt, now.isNew, now.title]).toEqual([item.consumedAt, item.isNew, item.title])
      }
    })

    it('hands back what it needs for Undo, and Undo puts the exact order back', async () => {
      const list = await apiList()
      await send('POST', `/lists/${list.id}/groups`, { name: 'Empty' })
      const before = await detail(list.id)

      const sorted = await send('POST', `/lists/${list.id}/sort`)
      const undone = await send('PUT', `/lists/${list.id}/order/restore`, sorted.json().restore)

      expect(undone.statusCode).toBe(200)
      expect(exact(await detail(list.id))).toEqual(exact(before))
    })

    it('is offered on every list, whatever its source, and is 404 for one that is not there', async () => {
      const manual = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()

      expect((await send('POST', `/lists/${manual.id}/sort`)).statusCode).toBe(200)
      expect((await send('POST', '/lists/nope/sort')).statusCode).toBe(404)
      expect((await send('PUT', '/lists/nope/order/restore', { items: [], groups: [] })).statusCode).toBe(404)
    })

    it('changes nothing about a list that is already in order', async () => {
      const list = await apiList()
      await send('POST', `/lists/${list.id}/sort`)
      const once = await detail(list.id)

      await send('POST', `/lists/${list.id}/sort`)

      expect(exact(await detail(list.id))).toEqual(exact(once))
    })
  })

  describe('Reset to the source — an API list', () => {
    /** Makes a mess: tick, delete, add by hand, add as arrivals, rename and add a group. */
    async function makeAMess(list: Detail) {
      await send('PUT', `/lists/${list.id}/items/${byTitle(list, 'Early One').id}/consumed`, { consumed: true })
      await send('DELETE', `/lists/${list.id}/items/${byTitle(list, 'Loose').id}`)
      await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      await send('POST', `/lists/${list.id}/items/import`, { items: [{ title: 'Arrived' }], arrived: true })
      const arcA = list.groups.find((g) => g.name === 'Arc A')!
      await send('PATCH', `/lists/${list.id}/groups/${arcA.id}`, { name: 'Renamed' })
      await send('POST', `/lists/${list.id}/groups`, { name: 'Mine' })
      await send('PATCH', `/lists/${list.id}`, { title: 'My title', description: 'Mine', status: 'complete' })
    }

    it('brings the list back exactly as a fresh import made it', async () => {
      const list = await apiList()
      const fresh = shape(list)
      await makeAMess(list)
      expect(shape(await detail(list.id))).not.toEqual(fresh)

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(200)
      expect(shape(await detail(list.id))).toEqual(fresh)
    })

    it('makes no call to the source', async () => {
      const list = await apiList()
      expand.mockClear()

      await send('POST', `/lists/${list.id}/reset`)
      await send('GET', `/lists/${list.id}/reset-preview`)

      expect(expand).not.toHaveBeenCalled()
    })

    it('says what it did: what it removed, what it brought back, what it un-ticked', async () => {
      const list = await apiList()
      await makeAMess(list)

      const reset = (await send('POST', `/lists/${list.id}/reset`)).json()

      expect(reset.counts).toEqual({ removed: 2, restored: 1, doneCleared: 1 })
    })

    it('says the same in advance, and writes nothing', async () => {
      const list = await apiList()
      await makeAMess(list)
      const before = exact(await detail(list.id))

      const preview = await send('GET', `/lists/${list.id}/reset-preview`)

      expect(preview.json()).toMatchObject({ removed: 2, restored: 1, doneCleared: 1 })
      expect(exact(await detail(list.id))).toEqual(before)
    })

    it('clears what was deleted by hand, so a refresh offers it again', async () => {
      const list = await apiList()
      await send('DELETE', `/lists/${list.id}/items/${byTitle(list, 'Loose').id}`)

      await send('POST', `/lists/${list.id}/reset`)
      const refreshed = (await send('POST', `/lists/${list.id}/refresh`)).json()

      expect(refreshed.dismissedCount).toBe(0)
      expect(refreshed.newItems).toEqual([])
    })

    it('is not changed by a later refresh-add: the snapshot stays what arrived', async () => {
      const list = await apiList()
      const fresh = shape(list)
      await send('POST', `/lists/${list.id}/items/import`, { items: [{ title: 'Later' }], arrived: true })

      await send('POST', `/lists/${list.id}/reset`)

      expect(shape(await detail(list.id))).toEqual(fresh)
    })

    it('asks for a follow-up check for an API list with a source ref', async () => {
      const list = await apiList()

      expect((await send('POST', `/lists/${list.id}/reset`)).json().followUpCheck).toBe(true)
      expect((await send('GET', `/lists/${list.id}/reset-preview`)).json().followUpCheck).toBe(true)
    })

    it('undoes exactly: ids, order, groups, ticks, markers, title and dismissals', async () => {
      const list = await apiList()
      await makeAMess(list)
      const messy = await detail(list.id)

      const reset = await send('POST', `/lists/${list.id}/reset`)
      const undone = await send('PUT', `/lists/${list.id}/items/restore-all`, reset.json().restore)

      expect(undone.statusCode).toBe(200)
      expect(exact(await detail(list.id))).toEqual(exact(messy))
      // The deletion recorded before the reset still holds a refresh back.
      expect(((await send('POST', `/lists/${list.id}/refresh`)).json()).dismissedCount).toBe(1)
    })
  })

  describe('a Reset that fails part-way', () => {
    it('puts the list back as it was, and reports the failure', async () => {
      const created = await send('POST', '/lists/from-file', {
        yaml: 'title: T\ncategory: mega\nitems:\n  - { title: A }\n  - { title: B }\n  - { title: C }\n',
      })
      const id = created.json().id
      await send('POST', `/lists/${id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      const before = exact(await detail(id))

      let inserts = 0
      const flaky = new Proxy(harness.db, {
        get(target, key) {
          const value = Reflect.get(target, key)
          if (key === 'insert') {
            return (table: unknown) => {
              if (table === listItems && (inserts += 1) === 3) throw new Error('boom')
              return target.insert(table as typeof listItems)
            }
          }
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const userId = harness.db.select().from(users).get()!.id

      await expect(
        resetToSource(flaky, userId, id, { mediaTypes: [{ key: 'mega', defaultDurationMinutes: 120 }] }),
      ).rejects.toThrow('boom')

      expect(exact(await detail(id))).toEqual(before)
    })
  })

  describe('Reset to the source — a canonical list', () => {
    const yaml = (body: string) => `title: MCU\ndescription: Watch order\ncategory: mega\nstatus: ongoing\nitems:\n${body}`
    const stub = (text: string, status = 200) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status })))

    async function canonicalList(body = "  - { title: Iron Man, group: Phase 1, year: 2008 }\n  - { title: Thor, group: Phase 1, year: 2011 }\n") {
      stub(yaml(body))
      const created = await send('POST', '/lists/from-source', {
        mediaType: 'mega',
        externalRef: 'canonical:lists/mega/mcu.yaml',
        title: 'MCU',
      })
      expect(created.statusCode).toBe(201)
      return detail(created.json().id)
    }

    it('re-reads the live file, with its title, description and status, and drops the rest', async () => {
      const list = await canonicalList()
      await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      await send('PATCH', `/lists/${list.id}`, { title: 'Mine' })
      stub(
        'title: MCU Reloaded\ndescription: New order\ncategory: mega\nstatus: complete\nitems:\n  - { title: Iron Man, group: Phase 1, year: 2008 }\n  - { title: Avengers, group: Phase 1, year: 2012 }\n',
      )

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(200)
      const after = await detail(list.id)
      expect(after).toMatchObject({ title: 'MCU Reloaded', description: 'New order', status: 'complete' })
      expect(after.items.map((i) => i.title)).toEqual(['Iron Man', 'Avengers'])
      expect(reset.json().counts).toMatchObject({ removed: 2, restored: 1 })
    })

    it('asks for no follow-up check: it was just read live', async () => {
      const list = await canonicalList()
      stub(yaml("  - { title: Iron Man }\n"))

      expect((await send('POST', `/lists/${list.id}/reset`)).json().followUpCheck).toBe(false)
    })

    it('reads the file afresh every time, never from an earlier answer', async () => {
      const list = await canonicalList()
      const fetchMock = vi.fn(async () => new Response(yaml('  - { title: Iron Man }\n'), { status: 200 }))
      vi.stubGlobal('fetch', fetchMock)

      await send('POST', `/lists/${list.id}/reset`)
      await send('POST', `/lists/${list.id}/reset`)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('refuses, and leaves the list exactly as it was, when the file cannot be fetched', async () => {
      const list = await canonicalList()
      const before = exact(await detail(list.id))
      vi.stubGlobal('fetch', vi.fn(async () => { throw new IngestionError('down') }))

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(502)
      expect(exact(await detail(list.id))).toEqual(before)
    })

    it('refuses, and changes nothing, when the file no longer parses', async () => {
      const list = await canonicalList()
      const before = exact(await detail(list.id))
      stub('title: [unclosed')

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(400)
      expect(exact(await detail(list.id))).toEqual(before)
    })

    it('undoes exactly', async () => {
      const list = await canonicalList()
      await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      const messy = await detail(list.id)
      stub(yaml('  - { title: Thor }\n'))

      const reset = await send('POST', `/lists/${list.id}/reset`)
      await send('PUT', `/lists/${list.id}/items/restore-all`, reset.json().restore)

      expect(exact(await detail(list.id))).toEqual(exact(messy))
    })
  })

  describe('Reset to the source — a file list', () => {
    const yaml = 'title: Mine\ndescription: From a file\ncategory: mega\nstatus: complete\nitems:\n  - { title: One, year: 2000 }\n  - { title: Two, year: 2001, group: G }\n'

    async function fileList() {
      const created = await send('POST', '/lists/from-file', { yaml })
      expect(created.statusCode).toBe(201)
      return detail(created.json().id)
    }

    it('re-reads the stored file, and restores what was changed', async () => {
      const list = await fileList()
      const fresh = shape(list)
      await send('DELETE', `/lists/${list.id}/items/${byTitle(list, 'One').id}`)
      await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      await send('PATCH', `/lists/${list.id}`, { title: 'Renamed', status: 'ongoing' })

      const reset = await send('POST', `/lists/${list.id}/reset`)

      expect(reset.statusCode).toBe(200)
      expect(shape(await detail(list.id))).toEqual(fresh)
      expect(reset.json().followUpCheck).toBe(false)
    })

    it('undoes exactly', async () => {
      const list = await fileList()
      await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })
      const messy = await detail(list.id)

      const reset = await send('POST', `/lists/${list.id}/reset`)
      await send('PUT', `/lists/${list.id}/items/restore-all`, reset.json().restore)

      expect(exact(await detail(list.id))).toEqual(exact(messy))
    })
  })

  describe('An item’s source tags, for “Source says …” and Reset to source (U5)', () => {
    const sourceOf = async (listId: string, itemId: string) =>
      send('GET', `/lists/${listId}/items/${itemId}/source`)

    it('reads what the source says for the item, whatever it carries now', async () => {
      const list = await apiList()
      const late = byTitle(list, 'Late One')
      await send('PATCH', `/lists/${list.id}/items/${late.id}`, { tags: ['X360'] })

      expect((await sourceOf(list.id, late.id)).json()).toEqual({ sourced: true, tags: ['Film'] })
      expect((await sourceOf(list.id, byTitle(list, 'Early One').id)).json()).toEqual({ sourced: true, tags: null })
    })

    it('says an item added by hand, or a list made by hand, has no source', async () => {
      const list = await apiList()
      const added = (await send('POST', `/lists/${list.id}/items`, { title: 'By hand', timeToConsumeMinutes: 5 })).json()
      expect((await sourceOf(list.id, added.id)).json()).toEqual({ sourced: false, tags: null })

      const hand = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()
      const item = (await send('POST', `/lists/${hand.id}/items`, { title: 'A', timeToConsumeMinutes: 5 })).json()
      expect((await sourceOf(hand.id, item.id)).json()).toEqual({ sourced: false, tags: null })
    })

    it('reads a file list’s stored file', async () => {
      const created = await send('POST', '/lists/from-file', {
        yaml: 'title: T\ncategory: mega\nitems:\n  - { title: A, tags: [game] }\n',
      })
      const list = await detail(created.json().id)

      expect((await sourceOf(list.id, byTitle(list, 'A').id)).json()).toEqual({ sourced: true, tags: ['game'] })
    })

    it('is 404 for an item that is not there', async () => {
      const list = await apiList()
      expect((await sourceOf(list.id, 'nope')).statusCode).toBe(404)
    })
  })

  describe('Reset is refused where there is nothing to reset to', () => {
    it('for a hand-made list', async () => {
      const list = (await send('POST', '/lists', { title: 'Hand', mediaType: 'mega' })).json()

      for (const response of [
        await send('POST', `/lists/${list.id}/reset`),
        await send('GET', `/lists/${list.id}/reset-preview`),
      ]) {
        expect(response.statusCode).toBe(409)
        expect(response.json().code).toBe('reset.unavailable')
      }
    })

    it('for an API list that arrived before snapshots were kept', async () => {
      const list = await apiList()
      const { listSnapshots } = await import('../db/schema.js')
      harness.db.delete(listSnapshots).run()

      const response = await send('POST', `/lists/${list.id}/reset`)

      expect(response.statusCode).toBe(409)
      expect(response.json().code).toBe('reset.unavailable')
      expect((await detail(list.id)).items).toHaveLength(list.items.length)
    })

    it('for a file list with no stored file', async () => {
      const created = await send('POST', '/lists/from-file', {
        yaml: 'title: T\ncategory: mega\nitems:\n  - { title: A }\n',
      })
      const { lists } = await import('../db/schema.js')
      harness.db.update(lists).set({ sourceYaml: null }).run()

      const response = await send('POST', `/lists/${created.json().id}/reset`)

      expect(response.statusCode).toBe(409)
    })

    it('for a list that is not there', async () => {
      expect((await send('POST', '/lists/nope/reset')).statusCode).toBe(404)
      expect((await send('GET', '/lists/nope/reset-preview')).statusCode).toBe(404)
    })
  })
})
