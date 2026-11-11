import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXZED_SKINS } from '../../lib/preferences/exzedSkins.js'
import { read } from './cssGuard.js'

/**
 * eX-Zed's skin art (Phase 50, X-006). Each skin's pictures are drawn by CSS rules under that skin's `data-theme`, so the browser requests only the active skin's
 * files (the others' `url()`s never match), and every picture is a committed file the geometry doc (`docs/design/exzed-art-geometry.md`) lists with its checksum.
 * A skin is either built (its rules and files are here) or pending (it has none yet): one that is neither fails, so adding a skin cannot leave it without art by accident,
 * and each art task moves its skins from `PENDING` to `BUILT`.
 */
const ART = join(import.meta.dirname, 'art')
const css = read('styles/theme/exzed-art.css')

const BUILT: readonly string[] = ['exzed-1d']
const PENDING: readonly string[] = ['exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l']

/** The sha256 of each committed file (the design system's, `1794405214-5c6f`; the geometry doc's table). */
const CHECKSUMS: Record<string, string> = {
  'red-bricks-wall.png': '66bbb9b143925916ddd94c5d0f40d35d8ae25d62a00158d8f141e6d28829298e',
  'red-bricks-cornice.png': 'b1e453e0984bc24c5cc422c431da0b9aac87c85bdf9f3897ce592c52da536c44',
}

const rulesFor = (skin: string) => [...css.matchAll(new RegExp(`html\\[data-theme='${skin}'\\][^{]*{[^}]*}`, 'g'))].map((match) => match[0])
const urls = [...css.matchAll(/url\(['"]?\.\/art\/([^'")]+)['"]?\)/g)].map((match) => match[1]!)

describe('the skin art', () => {
  it('every eX-Zed skin is built or pending, and none is both', () => {
    expect([...BUILT, ...PENDING].sort()).toEqual([...EXZED_SKINS].sort())
  })

  it.each(BUILT)('%s has its rules in exzed-art.css', (skin) => {
    expect(rulesFor(skin).length).toBeGreaterThan(0)
  })

  it.each(PENDING)('%s has none yet', (skin) => {
    expect(rulesFor(skin)).toEqual([])
  })

  it('every picture a rule names is a committed file with the design system’s checksum', () => {
    expect(urls.length).toBeGreaterThan(0)
    for (const name of new Set(urls)) {
      const file = join(ART, name)
      expect(existsSync(file), `${name} exists`).toBe(true)
      expect(createHash('sha256').update(readFileSync(file)).digest('hex'), `${name} is the design system’s file`).toBe(CHECKSUMS[name])
    }
  })

  it('every committed picture is used by a rule: no orphan', () => {
    expect(readdirSync(ART).filter((name) => name.endsWith('.png')).sort()).toEqual([...new Set(urls)].sort())
  })

  it('a picture is named by the skin that owns it only: a skin’s rule never names another skin’s file', () => {
    const lode = rulesFor('exzed-1d').join('\n')

    expect([...lode.matchAll(/art\/([^'")]+)/g)].map((match) => match[1]).sort()).toEqual(['red-bricks-cornice.png', 'red-bricks-wall.png'])
  })

  it('draws pixel for pixel: pixelated, and no scaling beyond the file’s own size', () => {
    expect(css).toMatch(/image-rendering:\s*pixelated/)
    expect(rulesFor('exzed-1d').join('\n')).toMatch(/red-bricks-wall\.png'\) 0 0 \/ 240px 84px repeat/)
    expect(rulesFor('exzed-1d').join('\n')).toMatch(/red-bricks-cornice\.png'\) 0 0 \/ 64px 16px repeat-x/)
  })

  it('nothing here is Quantum’s: every rule is under the eX-Zed class or an eX-Zed skin key', () => {
    const selectors = [...css.matchAll(/(^|})\s*([^{}@]+){/g)].map((match) => match[2]!.trim())

    for (const selector of selectors) expect(selector, selector).toMatch(/^html(\.theme-exzed|\[data-theme='exzed-1[dabcel]'\])/)
  })
})
