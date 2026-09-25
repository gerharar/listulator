import { describe, expect, it } from 'vitest'
import { parseCustomList } from '../../../server/src/ingestion/customLists.js'
import type { ListItem, MediaListDetail } from './api.js'
import { exportFileName, exportList } from './exportList.js'

const CATEGORIES = new Set(['movie', 'tv', 'mega'])

let n = 0
function item(overrides: Partial<ListItem> = {}): ListItem {
  n += 1
  return {
    id: `i${n}`,
    listId: 'L1',
    title: `Item ${n}`,
    orderIndex: n,
    timeToConsumeMinutes: 60,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    isNew: false,
    ...overrides,
  }
}

function list(items: ListItem[], overrides: Partial<MediaListDetail> = {}): MediaListDetail {
  return {
    id: 'L1',
    title: 'Jackie Chan',
    description: null,
    mediaType: 'movie',
    source: 'file',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items,
    groups: [],
    ...overrides,
  } as MediaListDetail
}

/** What the real parser makes of the export. */
const back = (detail: MediaListDetail) => parseCustomList(exportList(detail), CATEGORIES)

describe('exportList', () => {
  it('writes the title, category, description and status the parser reads back', () => {
    const parsed = back(
      list([item({ title: 'A' })], { title: 'My list', description: 'About it', mediaType: 'tv', status: 'ongoing' }),
    )

    expect(parsed).toMatchObject({ title: 'My list', description: 'About it', category: 'tv', status: 'ongoing' })
  })

  it('leaves out a description and a status the list does not have', () => {
    const text = exportList(list([item()]))

    expect(text).not.toMatch(/^description:/m)
    expect(text).not.toMatch(/^status:/m)
  })

  it('round-trips every item field, in the list’s own order', () => {
    const detail = list([
      item({ title: 'Third', orderIndex: 3, year: 1999, timeToConsumeMinutes: 90, tags: ['Film', 'Live'], group: 'Arc', notes: 'The game has extra missions.' }),
      item({ title: 'First', orderIndex: 1 }),
      item({ title: 'Second', orderIndex: 2, year: 2001, group: 'Arc' }),
    ])

    const parsed = back(detail)

    expect(parsed.items).toEqual([
      { title: 'First', minutes: 60 },
      { title: 'Second', minutes: 60, year: 2001, group: 'Arc' },
      { title: 'Third', minutes: 90, year: 1999, group: 'Arc', tags: ['Film', 'Live'], notes: 'The game has extra missions.' },
    ])
  })

  it('does not write a runtime that is only an estimate, so it is still an estimate on the way back in', () => {
    const parsed = back(list([item({ title: 'Guess', timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })]))

    expect(parsed.items[0]).toEqual({ title: 'Guess' })
  })

  it('writes no done marks, no markers and no ids', () => {
    const text = exportList(list([item({ title: 'Ticked', consumedAt: '2026-01-01T00:00:00Z', isNew: true })]))

    expect(text).not.toMatch(/consumed|isNew|done|i\d+/i)
  })

  it('keeps an item added by hand: the format has no way to say it was', () => {
    const parsed = back(list([item({ title: 'Mine', source: 'manual' })]))

    expect(parsed.items.map((i) => i.title)).toEqual(['Mine'])
  })

  it('survives titles and notes that YAML would otherwise misread', () => {
    const tricky = [
      '1984',
      'true',
      'null',
      'Yes',
      'Re: Zero — Starting Life',
      '#hashtag',
      '- dash',
      "It's \"quoted\"",
      ' leading and trailing space ',
      'Ünïcode ☃',
      '{braces}, [brackets]',
      'key: value',
      '0x1F',
      '1e3',
    ]
    const notes = 'Line one.\nLine two: with a colon.\n\n  Indented "quote" # not a comment'
    const detail = list(tricky.map((title) => item({ title, notes })), {
      title: 'Colon: title #1',
      description: 'A description: with "quotes"\nand two lines',
    })

    const parsed = back(detail)

    expect(parsed.title).toBe('Colon: title #1')
    expect(parsed.description).toBe('A description: with "quotes"\nand two lines')
    expect(parsed.items.map((i) => i.title)).toEqual(tricky)
    for (const parsedItem of parsed.items) expect(parsedItem.notes).toBe(notes.trim())
  })

  it('writes each item on one line, as the shipped lists do', () => {
    const text = exportList(list([item({ title: 'One', year: 2000 }), item({ title: 'Two' })]))

    expect(text).toMatch(/^ {2}- \{title: One, year: 2000, minutes: 60\}$/m)
  })

  it('round-trips a list of ten thousand items', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => item({ title: `T${i}`, orderIndex: i, year: 1900 + (i % 100) }))

    expect(back(list(many)).items).toHaveLength(10_000)
  })

  it('exports a list with no items as a file the importer will refuse for having none, not a broken one', () => {
    expect(() => back(list([]))).not.toThrow()
    expect(back(list([])).items).toEqual([])
  })
})

describe('exportFileName', () => {
  it('is the title, made safe for a file, with .yaml', () => {
    expect(exportFileName('Jackie Chan: Acting Roles / 1')).toBe('Jackie Chan Acting Roles 1.yaml')
  })

  it('falls back to a name when the title has nothing usable', () => {
    expect(exportFileName('///')).toBe('list.yaml')
  })

  it('does not run on forever for a very long title', () => {
    expect(exportFileName('x'.repeat(500)).length).toBeLessThanOrEqual(105)
  })
})
