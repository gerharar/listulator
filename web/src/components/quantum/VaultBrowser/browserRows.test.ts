import { describe, expect, it } from 'vitest'
import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { browserTime, DEFAULT_SORT, nextSort, sortRows } from './browserRows.js'

const row = (title: string, extra: Partial<LibraryBrowserEntry> = {}): LibraryBrowserEntry => ({
  externalRef: `canonical:lists/movie/${title}.yaml`,
  title,
  category: 'movie',
  tracked: false,
  ...extra,
})
const titles = (rows: readonly LibraryBrowserEntry[]) => rows.map((entry) => entry.title)

describe('nextSort', () => {
  it('opens on Name A to Z', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'name', dir: 1 })
  })

  it('sorts a column first by its natural direction: Name and Status A to Z, Items and Time largest first', () => {
    const from = { key: 'items', dir: -1 } as const
    expect(nextSort(from, 'name')).toEqual({ key: 'name', dir: 1 })
    expect(nextSort(from, 'status')).toEqual({ key: 'status', dir: 1 })
    expect(nextSort(DEFAULT_SORT, 'items')).toEqual({ key: 'items', dir: -1 })
    expect(nextSort(DEFAULT_SORT, 'time')).toEqual({ key: 'time', dir: -1 })
  })

  it('reverses on a second click of the same column, and back', () => {
    const once = nextSort(DEFAULT_SORT, 'name')
    expect(once).toEqual({ key: 'name', dir: -1 })
    expect(nextSort(once, 'name')).toEqual({ key: 'name', dir: 1 })
  })
})

describe('sortRows', () => {
  const rows = [
    row('Charlie', { itemCount: 10, totalMinutes: 600, status: 'ongoing' }),
    row('alpha', { itemCount: 50_000, totalMinutes: 30, status: 'complete' }),
    row('Bravo', { itemCount: 3, totalMinutes: 90 }),
  ]

  it('sorts by name A to Z without regard to case, and reverses', () => {
    expect(titles(sortRows(rows, { key: 'name', dir: 1 }))).toEqual(['alpha', 'Bravo', 'Charlie'])
    expect(titles(sortRows(rows, { key: 'name', dir: -1 }))).toEqual(['Charlie', 'Bravo', 'alpha'])
  })

  it('sorts by items, numerically, and reverses', () => {
    expect(titles(sortRows(rows, { key: 'items', dir: -1 }))).toEqual(['alpha', 'Charlie', 'Bravo'])
    expect(titles(sortRows(rows, { key: 'items', dir: 1 }))).toEqual(['Bravo', 'Charlie', 'alpha'])
  })

  it('sorts by time, and reverses', () => {
    expect(titles(sortRows(rows, { key: 'time', dir: -1 }))).toEqual(['Charlie', 'Bravo', 'alpha'])
    expect(titles(sortRows(rows, { key: 'time', dir: 1 }))).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  it('orders status complete, unknown, ongoing, and reverses', () => {
    expect(titles(sortRows(rows, { key: 'status', dir: 1 }))).toEqual(['alpha', 'Bravo', 'Charlie'])
    expect(titles(sortRows(rows, { key: 'status', dir: -1 }))).toEqual(['Charlie', 'Bravo', 'alpha'])
  })

  it('breaks a tie by name A to Z, whichever way the column goes', () => {
    const tied = [row('B', { itemCount: 5 }), row('C', { itemCount: 5 }), row('A', { itemCount: 5 }), row('D', { itemCount: 9 })]

    expect(titles(sortRows(tied, { key: 'items', dir: -1 }))).toEqual(['D', 'A', 'B', 'C'])
    expect(titles(sortRows(tied, { key: 'items', dir: 1 }))).toEqual(['A', 'B', 'C', 'D'])
  })

  it('counts a missing item count or time as the least, so an older index does not scramble the table', () => {
    const older = [row('A', { itemCount: 4, totalMinutes: 60 }), row('B'), row('C', { itemCount: 2, totalMinutes: 30 })]

    expect(titles(sortRows(older, { key: 'items', dir: -1 }))).toEqual(['A', 'C', 'B'])
    expect(titles(sortRows(older, { key: 'time', dir: -1 }))).toEqual(['A', 'C', 'B'])
  })

  it('leaves its argument alone', () => {
    const copy = [...rows]
    sortRows(rows, { key: 'items', dir: 1 })

    expect(rows).toEqual(copy)
  })
})

describe('browserTime', () => {
  it.each([
    [0, '0m'],
    [45, '45m'],
    [59, '59m'],
    [60, '1h'],
    [89, '1h'],
    [90, '2h'],
    [149, '2h'],
    [150, '3h'],
    [5_820, '97h'],
  ])('writes %i minutes as %s: minutes under an hour, otherwise whole hours rounded half up', (minutes, written) => {
    expect(browserTime(minutes)).toBe(written)
  })
})
