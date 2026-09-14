import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateListsIndex } from './generateListsIndex.js'

const CATEGORIES = new Set(['movie', 'mega', 'book'])

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

    const entries = generateListsIndex(dir, CATEGORIES)

    expect(entries).toEqual([
      { path: 'lists/book/lotr.yaml', title: 'LOTR', category: 'book' },
      { path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' },
    ])
  })

  it('ignores non-YAML files', () => {
    write('mega/mcu.yaml', 'title: MCU\ncategory: mega\nitems:\n  - { title: Iron Man }\n')
    write('README.md', '# not a list')

    expect(generateListsIndex(dir, CATEGORIES)).toHaveLength(1)
  })

  it('fails loudly, naming the offending file, rather than writing a partial manifest', () => {
    write('mega/good.yaml', 'title: Good\ncategory: mega\nitems:\n  - { title: A }\n')
    write('mega/bad.yaml', 'title: Bad\ncategory: not-a-real-category\nitems:\n  - { title: A }\n')

    expect(() => generateListsIndex(dir, CATEGORIES)).toThrow(/bad\.yaml/)
  })
})
