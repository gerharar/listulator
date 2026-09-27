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

  it('accepts a Music list tagged Mini, EP, Single and Live alike (owner, 2026-09-27)', () => {
    const path = join(dir, 'music.yaml')
    writeFileSync(
      path,
      'title: X\ncategory: music\nitems:\n  - { title: A, tags: [Mini] }\n  - { title: B, tags: [EP, Live] }\n  - { title: C, tags: [Single] }\n',
    )

    expect(validateListFiles([path], new Set(['music']), new Set(['game']))).toEqual([])
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

  describe('platform codes (10.24c): a curated Games list uses the codes in config/platforms.csv', () => {
    const GAMES = new Set(['game', 'mega'])
    const write = (items: string) => {
      const path = join(dir, 'games.yaml')
      writeFileSync(path, `title: G\ncategory: game\nitems:\n${items}`)
      return path
    }

    it('accepts known codes in any case', () => {
      const path = write('  - { title: A, tags: [WIN, ps3] }\n')

      expect(validateListFiles([path], GAMES, new Set(['game']))).toEqual([])
    })

    it('refuses a bare multi: it is not a platform (owner, U5)', () => {
      const path = write('  - { title: B, tags: [multi] }\n')

      expect(validateListFiles([path], GAMES, new Set(['game'])).join()).toContain('multi')
    })

    it('refuses an unknown code and an old one, naming the item and the code', () => {
      const path = write('  - { title: Halo, tags: [X360, Some Box] }\n  - { title: Doom, tags: [PC] }\n')

      const errors = validateListFiles([path], GAMES, new Set(['game']))

      expect(errors).toHaveLength(2)
      expect(errors[0]).toMatch(/Halo.*Some Box/)
      expect(errors[1]).toMatch(/Doom.*PC.*WIN/)
    })

    it('leaves other categories’ tags alone: a Mega item’s game/movie tags are media, not platforms', () => {
      const path = join(dir, 'mega.yaml')
      writeFileSync(path, 'title: M\ncategory: mega\nitems:\n  - { title: A, tags: [game, movie] }\n')

      expect(validateListFiles([path], GAMES, new Set(['game']))).toEqual([])
    })
  })
})

