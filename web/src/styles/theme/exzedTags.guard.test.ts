import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's tags, marks and chips (51.6, X-007), `styles/theme/exzed-tags.css`: under `html.theme-exzed` only, in the skin's roles only (no literal colour, alpha, radius, opacity, filter or
 * shadow: the ring round a tag is an outline), the Tag, Mark and board sizes, every hover rule excluding a disabled control, and the Tag card's colours: Complete `ok`, Ongoing and NEW `info`,
 * the key states `ok` and `warn`, the medium tag and the platform chip a 2px `ink2` outline.
 */
const FILE = 'styles/theme/exzed-tags.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-tags.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
/** Every declaration of the rules that name the selector (a shared rule and the element's own), joined. */
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s tags, marks and chips', () => {
  it('is a stylesheet main.tsx imports after the checkbox and links', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-tags\.css'/)
    expect(main.indexOf('exzed-tags.css')).toBeGreaterThan(main.indexOf('exzed-checkbox-links.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(30)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('every hover rule excludes a disabled control', () => {
    for (const selector of rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))) {
      if (selector.includes(':hover')) expect(selector, selector).toContain(':where(:not(:disabled')
    }
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius\s*:\s*[^0;\s]|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '6', '8', '16', '20']).toContain(size)
  })

  it('draws a status tag as a 20px block of its colour with chip-ink text and a 2px chip-ink outline for the ring (never a shadow)', () => {
    const tag = body('html.theme-exzed .q-status')
    expect(tag).toMatch(/height:\s*20px;/)
    expect(tag).toMatch(/background:\s*var\(--tag\);/)
    expect(tag).toMatch(/outline:\s*2px solid var\(--zx-chip-ink\);/)
    expect(tag).toMatch(/color:\s*var\(--zx-chip-ink\);/)
    expect(tag).toMatch(/--tag:\s*var\(--zx-info\);/)
    expect(body('html.theme-exzed .q-status:not(.ongoing)')).toMatch(/--tag:\s*var\(--zx-ok\);/)
  })

  it('draws a key state as a tag: Working ok, Rejected, Offline and Failed warn, the others the ink2 outline', () => {
    expect(body('html.theme-exzed .q-key-pill')).toMatch(/border:\s*2px solid var\(--zx-ink2\);[^}]*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-key-pill.working')).toMatch(/--tag:\s*var\(--zx-ok\);/)
    for (const state of ['rejected', 'failed', 'unreachable']) expect(body(`html.theme-exzed .q-key-pill.${state}`)).toMatch(/--tag:\s*var\(--zx-warn\);/)
  })

  it('draws a mark as the 8x2 board drawing in its colour on a 16px chip-ink cell with a 2px ring, the stock icon hidden', () => {
    const mark = body('html.theme-exzed .q-star')
    expect(mark).toMatch(/--mark:\s*var\(--zx-star\);/)
    expect(mark).toMatch(/width:\s*16px;[^}]*height:\s*16px;/)
    expect(mark).toMatch(/background:\s*var\(--zx-chip-ink\);[^}]*outline:\s*2px solid var\(--zx-chip-ink\);/)
    expect(body('html.theme-exzed .q-star > svg')).toMatch(/display:\s*none;/)
    expect(body('html.theme-exzed .q-byhand')).toMatch(/--mark:\s*var\(--zx-hand\);/)
    expect(body('html.theme-exzed .q-status-mark')).toMatch(/--mark:\s*var\(--zx-ok\);/)
    expect(body('html.theme-exzed .q-status-mark.ongoing')).toMatch(/--mark:\s*var\(--zx-info\);/)
  })

  it('draws the medium tag and the platform chip as a 20px box with a 2px ink2 outline, and a column as wide as the longest plus 8px', () => {
    expect(body('html.theme-exzed .q-tag')).toMatch(/height:\s*20px;[^}]*border:\s*2px solid var\(--zx-ink2\);[^}]*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-tag.kind')).toMatch(/width:\s*calc\(var\(--kind-ch\) \* 1ch \+ 8px\);/)
    expect(body('html.theme-exzed .q-plat')).toMatch(/--plat-ch:\s*5;\s*width:\s*calc\(var\(--plat-ch\) \* 1ch \+ 8px\);/)
    expect(css).toMatch(/\.q-plat:where\(:not\(:disabled\):not\(\.readonly\)\):hover[^{]*{\s*background:\s*var\(--zx-hl-bg\);/)
  })

  it('draws the count chip and the key chip as the board’s 20px boxes with a 2px frame border, the key chip above the source line', () => {
    expect(body('html.theme-exzed .q-count-chip')).toMatch(/height:\s*20px;[^}]*border:\s*2px solid var\(--zx-frame\);[^}]*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-key-chip')).toMatch(/background:\s*var\(--zx-paper\);/)
    expect(body('html.theme-exzed .q-tile-foot')).toMatch(/flex-direction:\s*column-reverse;[^}]*gap:\s*6px;/)
  })

  it('draws the add chip’s icon, the done icon before ALL DONE and the Live flag as design’s answers D17, D19 and D20 say', () => {
    expect(body('html.theme-exzed button.q-tag-add.q-tag-add::before')).toMatch(/width:\s*16px;[^}]*height:\s*16px;[^}]*background:\s*currentColor;[^}]*mask:\s*url/)
    expect(body('html.theme-exzed button.q-tag-add.q-tag-add > svg')).toMatch(/display:\s*none;/)
    expect(body('html.theme-exzed .q-left .q-done-icon')).toMatch(/width:\s*16px;[^}]*height:\s*16px;[^}]*margin-right:\s*8px;[^}]*background:\s*currentColor;/)
    expect(body('html.theme-exzed .q-tag-mark')).toMatch(/width:\s*4px;\s*height:\s*4px;\s*margin-left:\s*8px;\s*border-radius:\s*0;/)
  })

  it('leaves the kind tag’s old width rule out of exzed.css (moved here)', () => {
    expect(read('styles/theme/exzed.css')).not.toMatch(/\.q-tag\.kind\s*{/)
  })
})
