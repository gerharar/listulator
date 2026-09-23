import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateListFiles } from './validateLists.js'

const CATEGORIES = new Set(['movie', 'book'])

describe('validateListFiles', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'listulator-validate-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports no errors for well-formed files', () => {
    const path = join(dir, 'good.yaml')
    writeFileSync(path, 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')

    expect(validateListFiles([path], CATEGORIES)).toEqual([])
  })

  it('reports one error per malformed file, each naming its own path', () => {
    const bad = join(dir, 'bad.yaml')
    const good = join(dir, 'good.yaml')
    writeFileSync(bad, 'title: X\ncategory: not-a-real-category\nitems:\n  - { title: A }\n')
    writeFileSync(good, 'title: X\ncategory: movie\nitems:\n  - { title: A }\n')

    const errors = validateListFiles([bad, good], CATEGORIES)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(bad)
  })

  it('collects every error rather than stopping at the first', () => {
    const bad1 = join(dir, 'bad1.yaml')
    const bad2 = join(dir, 'bad2.yaml')
    writeFileSync(bad1, 'title: X\ncategory: not-a-real-category\nitems:\n  - { title: A }\n')
    writeFileSync(bad2, 'not: valid\n- broken\n')

    expect(validateListFiles([bad1, bad2], CATEGORIES)).toHaveLength(2)
  })

  it('reports an error for a file that does not exist, without throwing', () => {
    const missing = join(dir, 'missing.yaml')

    const errors = validateListFiles([missing], CATEGORIES)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(missing)
  })
})
