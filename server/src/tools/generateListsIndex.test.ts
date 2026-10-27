import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateListsIndex, listTime } from './generateListsIndex.js'

// Distinct defaults, so a test can tell which category's default a list was given.
const DEFAULTS = new Map([
  ['movie', 100],
  ['mega', 150],
  ['book', 200],
])

describe('generateListsIndex', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'listulator-index-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function write(relativePath: string, contents: string): void {
    const full = join(dir, relativePath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }

  it('scans nested category folders and returns a sorted, flat manifest', () => {
    write('mega/mcu.yaml', 'title: MCU\ncategory: mega\nitems:\n  - { title: Iron Man }\n')
    write('book/lotr.yaml', 'title: LOTR\ncategory: book\nitems:\n  - { title: Fellowship }\n')

    const entries = generateListsIndex(dir, DEFAULTS)

    expect(entries).toEqual([
      { path: 'lists/book/lotr.yaml', title: 'LOTR', category: 'book', itemCount: 1, totalMinutes: 200, minutesEstimated: true },
      { path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega', itemCount: 1, totalMinutes: 150, minutesEstimated: true },
    ])
  })

  it('records how many items each list has, so the app can show it without fetching the file', () => {
    write('book/lotr.yaml', 'title: LOTR\ncategory: book\nitems:\n  - { title: A }\n  - { title: B }\n  - { title: C }\n')
    write('book/empty.yaml', 'title: Empty\ncategory: book\nitems: []\n')

    expect(generateListsIndex(dir, DEFAULTS).map((entry) => [entry.title, entry.itemCount])).toEqual([
      ['Empty', 0],
      ['LOTR', 3],
    ])
  })

  it('includes description and status when the YAML sets them, omits them when it does not', () => {
    write(
      'mega/mcu.yaml',
      'title: MCU\ndescription: Every film, in release order.\ncategory: mega\nstatus: complete\nitems:\n  - { title: Iron Man }\n',
    )
    write('book/lotr.yaml', 'title: LOTR\ncategory: book\nitems:\n  - { title: Fellowship }\n')

    const entries = generateListsIndex(dir, DEFAULTS)

    expect(entries).toEqual([
      { path: 'lists/book/lotr.yaml', title: 'LOTR', category: 'book', itemCount: 1, totalMinutes: 200, minutesEstimated: true },
      {
        path: 'lists/mega/mcu.yaml',
        title: 'MCU',
        category: 'mega',
        itemCount: 1,
        totalMinutes: 150,
        minutesEstimated: true,
        description: 'Every film, in release order.',
        status: 'complete',
      },
    ])
  })

  it('ignores non-YAML files', () => {
    write('mega/mcu.yaml', 'title: MCU\ncategory: mega\nitems:\n  - { title: Iron Man }\n')
    write('README.md', '# not a list')

    expect(generateListsIndex(dir, DEFAULTS)).toHaveLength(1)
  })

  it('fails loudly, naming the offending file, rather than writing a partial manifest', () => {
    write('mega/good.yaml', 'title: Good\ncategory: mega\nitems:\n  - { title: A }\n')
    write('mega/bad.yaml', 'title: Bad\ncategory: not-a-real-category\nitems:\n  - { title: A }\n')

    expect(() => generateListsIndex(dir, DEFAULTS)).toThrow(/bad\.yaml/)
  })

  it('says what is wrong in the file and where, not just a code', () => {
    write('mega/bad.yaml', 'title: X\ncategory: mega\nitems:\n  - { title: Mastermind, note: hi }\n')

    expect(() => generateListsIndex(dir, DEFAULTS)).toThrow(
      'lists/mega/bad.yaml failed to parse: list.fileInvalid: item 1 ("Mastermind"): unknown field "note" (allowed: title, year, minutes, group, tags, notes); did you mean "notes"?',
    )
  })

  describe('time', () => {
    const timeOf = (): { totalMinutes?: number; minutesEstimated?: boolean } | undefined => {
      const [entry] = generateListsIndex(dir, DEFAULTS)

      return entry
    }

    it('sums the minutes of the items and does not flag a list whose runtimes are all known', () => {
      write('movie/a.yaml', 'title: A\ncategory: movie\nitems:\n  - { title: One, minutes: 90 }\n  - { title: Two, minutes: 45 }\n')

      expect(timeOf()).toMatchObject({ totalMinutes: 135, minutesEstimated: false })
    })

    it("counts the category's default for an item without minutes, and flags the list", () => {
      write('movie/a.yaml', 'title: A\ncategory: movie\nitems:\n  - { title: One, minutes: 90 }\n  - { title: Two }\n')

      expect(timeOf()).toMatchObject({ totalMinutes: 190, minutesEstimated: true })
    })

    it('gives Mega its own default, not another category\'s', () => {
      write('mega/a.yaml', 'title: A\ncategory: mega\nitems:\n  - { title: One }\n  - { title: Two }\n')

      expect(timeOf()).toMatchObject({ totalMinutes: 300, minutesEstimated: true })
    })

    it('counts a runtime the app would refuse as missing, the same rule as when the list is added', () => {
      // The parser refuses these in a file, so the rule is tested on the helper the generator uses.
      expect(listTime([{ minutes: 0 }, { minutes: 100_000 }, { minutes: 1.5 }], 10)).toEqual({
        totalMinutes: 30,
        minutesEstimated: true,
      })
    })

    it('is zero and not flagged for a list with no items', () => {
      write('movie/a.yaml', 'title: A\ncategory: movie\nitems: []\n')

      expect(timeOf()).toMatchObject({ totalMinutes: 0, minutesEstimated: false })
    })
  })
})
