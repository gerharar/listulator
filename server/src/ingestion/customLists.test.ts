import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CustomListParseError, parseCustomList, scanListsDropFolder } from './customLists.js'

const CATEGORIES = new Set(['movie', 'tv', 'book', 'mega'])

function fixture(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), 'utf8')
}

describe('parseCustomList', () => {
  it('parses a minimal valid list', () => {
    const yaml = `
title: Some List
category: movie
items:
  - { title: First, year: 2000, minutes: 90 }
  - { title: Second }
`
    expect(parseCustomList(yaml, CATEGORIES)).toEqual({
      title: 'Some List',
      category: 'movie',
      items: [
        { title: 'First', year: 2000, minutes: 90 },
        { title: 'Second' },
      ],
    })
  })

  it('preserves an optional group label per item', () => {
    const yaml = `
title: Grouped
category: tv
items:
  - { title: Pilot, group: Season 1 }
`
    expect(parseCustomList(yaml, CATEGORIES).items).toEqual([{ title: 'Pilot', group: 'Season 1' }])
  })

  it('trims the top-level title', () => {
    const yaml = 'title: "  Padded  "\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(parseCustomList(yaml, CATEGORIES).title).toBe('Padded')
  })

  it('rejects unparseable YAML', () => {
    expect(() => parseCustomList('title: [unclosed', CATEGORIES)).toThrow(CustomListParseError)
    try {
      parseCustomList('title: [unclosed', CATEGORIES)
    } catch (error) {
      expect((error as CustomListParseError).code).toBe('list.fileInvalid')
    }
  })

  it('rejects a document that is not a mapping', () => {
    expect(() => parseCustomList('- just\n- a\n- list', CATEGORIES)).toThrow(CustomListParseError)
  })

  it('rejects a missing top-level title', () => {
    const yaml = 'category: movie\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileMissingTitle' }),
    )
  })

  it('rejects a blank top-level title', () => {
    const yaml = 'title: "   "\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileMissingTitle' }),
    )
  })

  it('rejects an unknown category, naming it', () => {
    const yaml = 'title: X\ncategory: not-a-real-category\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.unknownCategory', params: { key: 'not-a-real-category' } }),
    )
  })

  it('rejects a missing category', () => {
    const yaml = 'title: X\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects items that is not an array', () => {
    const yaml = 'title: X\ncategory: movie\nitems: not-an-array\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects an item missing a title, naming its position', () => {
    const yaml = 'title: X\ncategory: movie\nitems:\n  - { title: First }\n  - { year: 2000 }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileItemMissingTitle', params: { index: 2 } }),
    )
  })

  it('rejects an unknown top-level field', () => {
    const yaml = 'title: X\ncategory: movie\nitems: []\nextra: true\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects an unknown per-item field', () => {
    const yaml = 'title: X\ncategory: movie\nitems:\n  - { title: X, minute: 90 }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects a non-number year or minutes, and a non-string group', () => {
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, year: "2000" }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, minutes: "90" }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, group: 5 }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
  })

  it('refuses a custom/executable tag outright — the actual safety guarantee', () => {
    // js-yaml's default `load()` (v4+) refuses any tag outside plain YAML —
    // `!!js/function` and friends only exist under the opt-in FULL_SCHEMA,
    // which this parser must never pass.
    expect(() =>
      parseCustomList('title: !!js/function "() => 1"\ncategory: movie\nitems: []\n', CATEGORIES),
    ).toThrow(CustomListParseError)
  })

  it('a YAML merge key smuggling extra top-level fields is still rejected', () => {
    // `<<` merge keys ARE a standard feature js-yaml's default loader
    // processes (not something this parser disables) — verified directly
    // against js-yaml rather than assumed. What actually stops one here is
    // the plain top-level field allowlist below: a merge that introduces any
    // field beyond title/category/items is rejected the same as a typo'd
    // field name would be.
    const merge = 'title: X\ncategory: movie\nitems: []\nanchor: &a { x: 1 }\n<<: *a\n'
    expect(() => parseCustomList(merge, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  describe('against the real example files from task 7.1', () => {
    const realCategories = new Set([
      'movie',
      'tv',
      'animation',
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
      'mega',
    ])

    it('parses the Marvel Cinematic Universe example', () => {
      const parsed = parseCustomList(fixture('lists/mega/marvel-cinematic-universe.yaml'), realCategories)

      expect(parsed.category).toBe('mega')
      expect(parsed.items).toHaveLength(23)
      expect(parsed.items[0]).toEqual({ title: 'Iron Man', year: 2008, minutes: 126 })
      expect(parsed.items.every((item) => item.minutes !== undefined)).toBe(true)
    })

    it('parses the Lord of the Rings example, with minutes omitted', () => {
      const parsed = parseCustomList(fixture('lists/book/lord-of-the-rings.yaml'), realCategories)

      expect(parsed.category).toBe('book')
      expect(parsed.items).toEqual([
        { title: 'The Fellowship of the Ring', year: 1954 },
        { title: 'The Two Towers', year: 1954 },
        { title: 'The Return of the King', year: 1955 },
      ])
      expect(parsed.items.every((item) => item.minutes === undefined)).toBe(true)
    })
  })
})

describe('scanListsDropFolder', () => {
  let dropDir: string

  beforeEach(() => {
    dropDir = mkdtempSync(join(tmpdir(), 'listulator-drop-'))
  })

  afterEach(() => {
    rmSync(dropDir, { recursive: true, force: true })
  })

  function drop(fileName: string, contents: string): void {
    writeFileSync(join(dropDir, fileName), contents)
  }

  it('creates the folder if it does not exist yet, returning no outcomes', () => {
    rmSync(dropDir, { recursive: true, force: true })
    expect(scanListsDropFolder(dropDir, CATEGORIES)).toEqual([])
    expect(existsSync(dropDir)).toBe(true)
  })

  it('parses a valid file and moves it to admitted/', () => {
    drop('good.yaml', 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')

    const outcomes = scanListsDropFolder(dropDir, CATEGORIES)

    expect(outcomes).toEqual([
      { fileName: 'good.yaml', result: { ok: true, list: { title: 'X', category: 'movie', items: [{ title: 'A' }] } } },
    ])
    expect(existsSync(join(dropDir, 'good.yaml'))).toBe(false)
    expect(existsSync(join(dropDir, 'admitted', 'good.yaml'))).toBe(true)
  })

  it('reports an invalid file and moves it to refused_entry/, not silently skipping it', () => {
    drop('bad.yaml', 'title: X\ncategory: not-real\nitems:\n  - { title: A }\n')

    const outcomes = scanListsDropFolder(dropDir, CATEGORIES)

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.fileName).toBe('bad.yaml')
    expect(outcomes[0]!.result.ok).toBe(false)
    expect((outcomes[0]!.result as { ok: false; error: CustomListParseError }).error).toBeInstanceOf(
      CustomListParseError,
    )
    expect(
      (outcomes[0]!.result as { ok: false; error: CustomListParseError }).error.code,
    ).toBe('list.unknownCategory')
    expect(existsSync(join(dropDir, 'bad.yaml'))).toBe(false)
    expect(existsSync(join(dropDir, 'refused_entry', 'bad.yaml'))).toBe(true)
  })

  it('processes multiple files independently — one bad file does not block the good ones', () => {
    drop('good1.yaml', 'title: A\ncategory: movie\nitems:\n  - { title: X }\n')
    drop('bad.yaml', 'title: [unclosed')
    drop('good2.yaml', 'title: B\ncategory: book\nitems:\n  - { title: Y }\n')

    const outcomes = scanListsDropFolder(dropDir, CATEGORIES)

    const byFile = new Map(outcomes.map((o) => [o.fileName, o.result.ok]))
    expect(byFile.get('good1.yaml')).toBe(true)
    expect(byFile.get('good2.yaml')).toBe(true)
    expect(byFile.get('bad.yaml')).toBe(false)
  })

  it('does not reprocess a file once admitted — a second scan sees nothing new', () => {
    drop('good.yaml', 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')
    scanListsDropFolder(dropDir, CATEGORIES)

    expect(scanListsDropFolder(dropDir, CATEGORIES)).toEqual([])
  })

  it('avoids overwriting a same-named file already in admitted/', () => {
    mkdirSync(join(dropDir, 'admitted'), { recursive: true })
    writeFileSync(join(dropDir, 'admitted', 'good.yaml'), 'pre-existing content')
    drop('good.yaml', 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')

    scanListsDropFolder(dropDir, CATEGORIES)

    expect(readFileSync(join(dropDir, 'admitted', 'good.yaml'), 'utf8')).toBe('pre-existing content')
    expect(existsSync(join(dropDir, 'admitted', 'good-2.yaml'))).toBe(true)
  })

  it('ignores non-yaml files and subdirectories entirely', () => {
    drop('notes.txt', 'not a list')
    mkdirSync(join(dropDir, 'some-other-dir'))

    expect(scanListsDropFolder(dropDir, CATEGORIES)).toEqual([])
    expect(existsSync(join(dropDir, 'notes.txt'))).toBe(true)
  })

  it('scans .yml as well as .yaml', () => {
    drop('good.yml', 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')

    const outcomes = scanListsDropFolder(dropDir, CATEGORIES)

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.result.ok).toBe(true)
  })
})
