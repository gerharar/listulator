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

const BUILT: readonly string[] = ['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c']
const PENDING: readonly string[] = ['exzed-1e', 'exzed-1l']

/** The sha256 of each committed file (the design system's, `1794405214-5c6f`; the geometry doc's table). */
const CHECKSUMS: Record<string, string> = {
  'red-bricks-wall.png': '66bbb9b143925916ddd94c5d0f40d35d8ae25d62a00158d8f141e6d28829298e',
  'red-bricks-cornice.png': 'b1e453e0984bc24c5cc422c431da0b9aac87c85bdf9f3897ce592c52da536c44',
  'blue-stones-wall.png': 'b0a320d958729fbe3d2973670844d4cd328a17f1f5089c8bb2f01daa08175d18',
  'blue-stones-separator.png': '00a3d5520ab2b999d01e118979aaae74f728107b0e44f3454cdc343f2df4025a',
  'grey-stones-wall.png': '28c72433a0973a3281876689842702c14ae65cb80da879c36ef8680b554883d7',
  'grey-stones-separator.png': 'ba465841378928e93f0dee2993e25966c5dda97f4c949edcef06a19813585012',
  'side-stripes.png': '3f84960812faaf381a3bb952814a5efd6474cf961a9323626e8a770acaebf909',
  'star-tile.png': 'f7ae1278c261e40b2e742f28f1373830951e476d71b39b713df1e2f6d5d91833',
  'space-left.png': '568ea30ab75d05e3f0b6e96fad2e7b0d076529bfbcdc9abecccb6fa91bd48b09',
  'space-right.png': '6d03c7820a7a6fd8ce1687929cf52ed7991343b5a309deaa4f631415de925d52',
  'space-parapet.png': '9db6134a9c433f7fe50d2f9cfdf74bed5938819fa3d31868a3259647c1e25d9b',
}

/** The files each built skin's rules name, and no others (the side stripes are the two stone skins' alike). */
const FILES: Record<string, readonly string[]> = {
  'exzed-1d': ['red-bricks-cornice.png', 'red-bricks-wall.png'],
  'exzed-1a': ['blue-stones-separator.png', 'blue-stones-wall.png', 'side-stripes.png'],
  'exzed-1b': ['grey-stones-separator.png', 'grey-stones-wall.png', 'side-stripes.png'],
  'exzed-1c': ['space-left.png', 'space-parapet.png', 'space-right.png', 'star-tile.png'],
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

  it.each(BUILT)('%s’s rules name its own files and no other skin’s', (skin) => {
    const named = [...new Set([...rulesFor(skin).join('\n').matchAll(/art\/([^'")]+)/g)].map((match) => match[1]))].sort()

    expect(named).toEqual(FILES[skin])
  })

  it('draws pixel for pixel: pixelated, at each file’s own size (the stone walls 2004x1542, the side stripes 2304 square)', () => {
    expect(css).toMatch(/image-rendering:\s*pixelated/)
    const lode = rulesFor('exzed-1d').join('\n')
    expect(lode).toMatch(/red-bricks-wall\.png'\) 0 0 \/ 240px 84px repeat/)
    expect(lode).toMatch(/red-bricks-cornice\.png'\) 0 0 \/ 64px 16px repeat-x/)
    for (const [skin, wall, fade] of [['exzed-1a', 'blue-stones-wall', 'blue-stones-separator'], ['exzed-1b', 'grey-stones-wall', 'grey-stones-separator']] as const) {
      const rules = rulesFor(skin).join('\n')
      expect(rules, skin).toMatch(new RegExp(`${wall}\\.png'\\) 0 0 / 2004px 1542px repeat`))
      expect(rules, skin).toMatch(new RegExp(`${fade}\\.png'\\) 0 0 / 8px 16px repeat-x`))
      expect(rules, skin).toMatch(/side-stripes\.png'\) 0 0 \/ 2304px 2304px no-repeat/)
    }
  })

  it('the side stripes are tied to the window: 128px inside its left edge and 200px inside its right, as design gives them', () => {
    for (const skin of ['exzed-1a', 'exzed-1b']) {
      const rules = rulesFor(skin).join('\n')

      expect(rules, skin).toMatch(/left:\s*calc\(var\(--header-gutter\) \+ 128px - 2304px\);\s*bottom:\s*-1824px/)
      expect(rules, skin).toMatch(/left:\s*calc\(100% - var\(--header-gutter\) - 200px\);\s*top:\s*-1860px/)
    }
  })

  it('Xen: the star field at 510px, the ground strip 28px high along the bottom, and the outpost columns standing on it, 28px up, 16px clear of the window', () => {
    const rules = rulesFor('exzed-1c').join('\n')

    expect(rules).toMatch(/star-tile\.png'\) 0 0 \/ 510px 510px repeat/)
    expect(rules).toMatch(/\[data-slot='bottom'\]\s*{\s*bottom:\s*0;\s*height:\s*28px;\s*background:\s*url\('\.\/art\/space-parapet\.png'\) 0 0 \/ 48px 28px repeat-x/)
    expect(rules).toMatch(/left:\s*calc\(var\(--header-gutter\) - 16px - 320px\);\s*bottom:\s*28px[^}]*space-left\.png'\) 0 0 \/ 320px 1400px no-repeat/)
    expect(rules).toMatch(/left:\s*calc\(100% - var\(--header-gutter\) \+ 16px\);\s*bottom:\s*28px[^}]*space-right\.png'\) 0 0 \/ 320px 1400px no-repeat/)
    // No strip under the header for Xen.
    expect(rules).not.toMatch(/\[data-slot='header'\]/)
  })

  it('the layers stand in design’s order: the ground, the stripes over it, the strip under the header over them', () => {
    const z = (slot: string) => Number(new RegExp(`\\[data-slot='${slot}'\\][^{]*{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1])

    expect(z('window')).toBeLessThan(z('sides'))
    expect(z('sides')).toBeLessThan(z('header'))
  })

  it('nothing here is Quantum’s: every rule is under the eX-Zed class or an eX-Zed skin key', () => {
    const selectors = [...css.matchAll(/(^|})\s*([^{}@]+){/g)].map((match) => match[2]!.trim())

    for (const selector of selectors) expect(selector, selector).toMatch(/^html(\.theme-exzed|\[data-theme='exzed-1[dabcel]'\])/)
  })
})
