import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LIST_FILE_MAX_CHARS,
  MAX_CONNECTOR_ITEMS,
  MAX_LIST_ITEMS,
} from '../catalog/limits.js'
import { LIBRARY_FILE_MAX_BYTES } from './customLists.js'
import { createTestApp, type TestApp } from '../testing/harness.js'

/**
 * The most a list may hold is 50,000 items for a file or a canonical list (owner, 2026-10-15: real lists of about 32,000),
 * and still 10,000 for what a connector reads. Every limit that scales with the list is held to it here: what a list
 * AT the ceiling needs in file size, body size and rows is checked together, so one cannot be raised without the others.
 */
const line = (n: number, group?: string) =>
  `  - { title: "Issue ${n}: a title of ordinary length", year: ${1960 + (n % 60)}, minutes: ${20 + (n % 90)}${group ? `, group: ${group}` : ''}, notes: "${'n'.repeat(40)}" }`

const file = (count: number) =>
  `title: Huge\ncategory: mega\nitems:\n${Array.from({ length: count }, (_, n) => line(n, `Volume ${Math.floor(n / 500)}`)).join('\n')}\n`

describe('the list ceiling and the limits that scale with it (25.0a)', () => {
  it('a list file at the item ceiling fits the file-size limit, the library limit and the request body, with room', () => {
    const text = file(MAX_LIST_ITEMS)

    // A line of about 150 characters: a file at the ceiling is about 7.5 MB, under every byte limit with room to spare.
    expect(text.length).toBeLessThan(LIST_FILE_MAX_CHARS / 2)
    expect(Buffer.byteLength(text)).toBeLessThan(LIBRARY_FILE_MAX_BYTES)
    // As the JSON string the from-file route receives (quotes and newlines escaped).
    expect(Buffer.byteLength(JSON.stringify({ yaml: text }))).toBeLessThan(LIST_FILE_MAX_CHARS + 2 * 1024 * 1024)
  })

  it('what a connector may read stays at ten thousand, below the list ceiling', () => {
    expect(MAX_CONNECTOR_ITEMS).toBe(10_000)
    expect(MAX_LIST_ITEMS).toBe(50_000)
  })
})

describe('a list at the ceiling, over HTTP', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as never } : {}) })

  it('builds from a file of 50,000 items, keeps every one in order, and refuses 50,001 whole, naming both numbers', async () => {
    const created = await send('POST', '/lists/from-file', { yaml: file(MAX_LIST_ITEMS) })

    expect(created.statusCode).toBe(201)
    const list = (await send('GET', `/lists/${created.json().id}`)).json()
    expect(list.items).toHaveLength(MAX_LIST_ITEMS)
    expect(list.items[0].title).toBe('Issue 0: a title of ordinary length')
    expect(list.items[MAX_LIST_ITEMS - 1].title).toBe(`Issue ${MAX_LIST_ITEMS - 1}: a title of ordinary length`)

    const refused = await send('POST', '/lists/from-file', { yaml: file(MAX_LIST_ITEMS + 1) })
    expect(refused.statusCode).toBe(400)
    expect(refused.json()).toMatchObject({ code: 'list.fileInvalid' })
    expect(refused.json().params.detail).toMatch(/50001 items.*50000/)
  }, 120_000)

  it('sorts, puts the order back, reorders by hand with 50,000 ids, and deletes: the whole-list requests fit their limits', async () => {
    const created = await send('POST', '/lists/from-file', { yaml: file(MAX_LIST_ITEMS) })
    const id = created.json().id as string

    const sorted = await send('POST', `/lists/${id}/sort`)
    expect(sorted.statusCode).toBe(200)
    expect((await send('PUT', `/lists/${id}/order/restore`, sorted.json().restore)).json()).toEqual({ restored: true })

    // 50,000 ids is about 2 MB of JSON, under the route's limit.
    const ids = ((await send('GET', `/lists/${id}`)).json().items as { id: string }[]).map((item) => item.id).reverse()
    expect((await send('PUT', `/lists/${id}/items/order`, { itemIds: ids })).statusCode).toBe(200)

    expect((await send('DELETE', `/lists/${id}`)).statusCode).toBeLessThan(300)
    expect((await send('GET', `/lists/${id}`)).statusCode).toBe(404)
  }, 180_000)

  it('accepts a file of about 13 MB (long notes), which only the raised request and file limits allow', async () => {
    const heavy = `title: Heavy\ncategory: mega\nitems:\n${Array.from({ length: 12_000 }, (_, n) => `  - { title: "Item ${n}", notes: "${'n'.repeat(1_100)}" }`).join('\n')}\n`
    expect(heavy.length).toBeGreaterThan(12 * 1024 * 1024)
    expect(heavy.length).toBeLessThan(LIST_FILE_MAX_CHARS)

    const created = await send('POST', '/lists/from-file', { yaml: heavy })

    expect(created.statusCode).toBe(201)
    expect(((await send('GET', `/lists/${created.json().id}`)).json().items as unknown[]).length).toBe(12_000)
  }, 120_000)

  it('refuses a file over the size limit before reading it', async () => {
    const response = await send('POST', '/lists/from-file', { yaml: `#${'x'.repeat(LIST_FILE_MAX_CHARS)}` })

    expect([400, 413]).toContain(response.statusCode)
  }, 60_000)
})
