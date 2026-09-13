import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CustomListParseError } from './customLists.js'
import { scanListsDropFolder } from './listsDropFolder.js'

const CATEGORIES = new Set(['movie', 'tv', 'book', 'mega'])

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
