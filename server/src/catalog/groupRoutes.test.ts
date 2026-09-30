import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'

/** The group endpoints and the list's `groups` (task 10.16, D3), over HTTP. */
describe('group routes', () => {
  let harness: TestApp
  let listId: string

  beforeEach(async () => {
    harness = createTestApp()
    const created = await harness.app.inject({
      method: 'POST',
      url: '/api/lists',
      payload: { title: 'Show', mediaType: 'tv' },
    })
    listId = created.json().id
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'GET', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as object } : {}) })

  const addGroup = async (name: string) =>
    (await send('POST', `/lists/${listId}/groups`, { name })).json()

  const addItem = (title: string, group?: string) =>
    send('POST', `/lists/${listId}/items`, {
      title,
      timeToConsumeMinutes: 30,
      ...(group ? { group } : {}),
    })

  const detail = async () => (await send('GET', `/lists/${listId}`)).json()

  it('a new list has no groups', async () => {
    expect((await detail()).groups).toEqual([])
  })

  it('creates an empty group, which shows up on the list in order', async () => {
    const response = await send('POST', `/lists/${listId}/groups`, { name: 'Season 1' })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'Season 1', orderIndex: 0 })
    await addGroup('Season 2')
    expect((await detail()).groups.map((g: { name: string }) => g.name)).toEqual(['Season 1', 'Season 2'])
  })

  it('shows the group an item’s label made, and where it was added', async () => {
    await addItem('a', 'Season 1')

    expect((await detail()).groups).toMatchObject([{ name: 'Season 1' }])
  })

  it('holds a group name to 255 characters when created or renamed', async () => {
    const max = 'g'.repeat(255)
    const over = 'g'.repeat(256)

    expect((await send('POST', `/lists/${listId}/groups`, { name: over })).statusCode).toBe(400)
    const created = await send('POST', `/lists/${listId}/groups`, { name: max })
    expect(created.statusCode).toBe(201)
    expect((await send('PATCH', `/lists/${listId}/groups/${created.json().id}`, { name: over })).statusCode).toBe(400)
  })

  it('refuses a taken name with a code, and a blank one', async () => {
    await addGroup('Season 1')

    const taken = await send('POST', `/lists/${listId}/groups`, { name: 'season 1' })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().code).toBe('group.nameTaken')

    const blank = await send('POST', `/lists/${listId}/groups`, { name: '   ' })
    expect(blank.statusCode).toBe(400)
    expect(blank.json().code).toBe('group.nameEmpty')
  })

  it('renames a group and relabels its items', async () => {
    await addItem('a', 'Old')
    const group = (await detail()).groups[0]

    const response = await send('PATCH', `/lists/${listId}/groups/${group.id}`, { name: 'New' })

    expect(response.statusCode).toBe(200)
    expect(response.json().name).toBe('New')
    expect((await detail()).items.map((item: { group: string }) => item.group)).toEqual(['New'])
  })

  it('refuses a rename to a name in use, and 404s for an unknown group', async () => {
    await addGroup('A')
    const b = await addGroup('B')

    const taken = await send('PATCH', `/lists/${listId}/groups/${b.id}`, { name: 'a' })
    expect(taken.statusCode).toBe(409)
    expect(taken.json().code).toBe('group.nameTaken')
    expect((await send('PATCH', `/lists/${listId}/groups/nope`, { name: 'X' })).statusCode).toBe(404)
  })

  it('deletes an empty group, and refuses one with items', async () => {
    const empty = await addGroup('Empty')
    await addItem('a', 'Full')
    const full = (await detail()).groups.find((g: { name: string }) => g.name === 'Full')

    expect((await send('DELETE', `/lists/${listId}/groups/${empty.id}`)).statusCode).toBe(200)

    const refused = await send('DELETE', `/lists/${listId}/groups/${full.id}`)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().code).toBe('group.notEmpty')
    expect((await send('DELETE', `/lists/${listId}/groups/nope`)).statusCode).toBe(404)
  })

  it('deletes a group with its items when asked to, leaving the other groups and items alone', async () => {
    await addItem('a', 'Full')
    await addItem('b', 'Full')
    await addItem('c', 'Other')
    await addItem('loose')
    const full = (await detail()).groups.find((g: { name: string }) => g.name === 'Full')

    const deleted = await send('DELETE', `/lists/${listId}/groups/${full.id}?withItems=true`)

    expect(deleted.statusCode).toBe(200)
    const after = await detail()
    expect(after.groups.map((g: { name: string }) => g.name)).toEqual(['Other'])
    expect(after.items.map((i: { title: string }) => i.title).sort()).toEqual(['c', 'loose'])
  })

  it('records the deleted items as unwanted, so a refresh does not offer them back', async () => {
    await addItem('a', 'Full')
    const full = (await detail()).groups[0]

    await send('DELETE', `/lists/${listId}/groups/${full.id}?withItems=true`)

    const dismissals = await harness.db.query.dismissedItems.findMany()
    expect(dismissals.map((d: { titleKey: string }) => d.titleKey)).toEqual(['a'])
  })

  it('reorders the groups, moving their items with them', async () => {
    await addItem('a1', 'A')
    await addItem('b1', 'B')
    const [a, b] = (await detail()).groups

    const response = await send('PUT', `/lists/${listId}/groups/order`, { groupIds: [b.id, a.id] })

    expect(response.statusCode).toBe(200)
    expect(response.json().map((g: { name: string }) => g.name)).toEqual(['B', 'A'])
    expect((await detail()).items.map((item: { title: string }) => item.title)).toEqual(['b1', 'a1'])
  })

  it('refuses a reorder that is not exactly the list’s groups', async () => {
    const a = await addGroup('A')
    await addGroup('B')

    const response = await send('PUT', `/lists/${listId}/groups/order`, { groupIds: [a.id] })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('group.orderMismatch')
  })

  it('makes a group for a label an item is moved into', async () => {
    const item = (await addItem('a')).json()

    await send('PATCH', `/lists/${listId}/items/${item.id}`, { group: 'Season 9' })

    expect((await detail()).groups).toMatchObject([{ name: 'Season 9' }])
  })

  it('404s for a list that does not exist', async () => {
    expect((await send('POST', '/lists/nope/groups', { name: 'X' })).statusCode).toBe(404)
    expect((await send('PUT', '/lists/nope/groups/order', { groupIds: ['x'] })).statusCode).toBe(404)
  })

  it('takes the groups away with the list', async () => {
    await addGroup('A')

    expect((await send('DELETE', `/lists/${listId}`)).statusCode).toBe(200)
    expect((await send('GET', `/lists/${listId}`)).statusCode).toBe(404)
  })
})
