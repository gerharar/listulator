import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, type TestApp } from '../testing/harness.js'

/**
 * H-005, over HTTP: a list file may say `year: "199?"` or `year: "19??"`; the rows keep the digits that are unknown, a
 * Reset puts a file list's years back as the file wrote them, and a file with a year that is not one is refused whole.
 */
describe('partial years in a list made from a file', () => {
  let harness: TestApp

  beforeEach(() => {
    harness = createTestApp()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  const send = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    harness.app.inject({ method, url: `/api${url}`, ...(payload ? { payload: payload as never } : {}) })

  const YAML = `title: Rehearsals
category: mega
items:
  - { title: Single, year: 1994 }
  - { title: Tape, year: "198?" }
  - { title: Demo, year: "19??" }
  - { title: Quoted, year: "1995" }
  - { title: Nothing }
`
  const years = async (id: string) =>
    ((await send('GET', `/lists/${id}`)).json().items as { title: string; year: number | null; yearUnk: number }[])
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((item) => [item.title, item.year, item.yearUnk])

  it('keeps each item’s year and how many of its digits are unknown', async () => {
    const created = await send('POST', '/lists/from-file', { yaml: YAML })

    expect(created.statusCode).toBe(201)
    expect(await years(created.json().id)).toEqual([
      ['Demo', 1900, 2],
      ['Nothing', null, 0],
      ['Quoted', 1995, 0],
      ['Single', 1994, 0],
      ['Tape', 1980, 1],
    ])
  })

  it('refuses the whole file for a year that is not one, naming the item', async () => {
    const response = await send('POST', '/lists/from-file', { yaml: 'title: X\ncategory: mega\nitems:\n  - { title: A, year: "19?4" }\n' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'list.fileInvalid' })
    expect(response.json().params.detail).toContain('item 1 ("A"): "year"')
  })

  it('puts the years back as the file wrote them on Reset, partial ones too', async () => {
    const id = (await send('POST', '/lists/from-file', { yaml: YAML })).json().id
    const items = (await send('GET', `/lists/${id}`)).json().items as { id: string; title: string }[]
    const tape = items.find((item) => item.title === 'Tape')!
    const single = items.find((item) => item.title === 'Single')!
    await send('PATCH', `/lists/${id}/items/${tape.id}`, { year: 1985 })
    await send('PATCH', `/lists/${id}/items/${single.id}`, { year: 1990, yearUnk: 1 })
    expect(await years(id)).toContainEqual(['Tape', 1985, 0])

    const reset = await send('POST', `/lists/${id}/reset`)

    expect(reset.statusCode).toBe(200)
    expect(await years(id)).toEqual([
      ['Demo', 1900, 2],
      ['Nothing', null, 0],
      ['Quoted', 1995, 0],
      ['Single', 1994, 0],
      ['Tape', 1980, 1],
    ])
  })
})
