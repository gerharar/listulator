import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's list rows (51.7, X-007), `styles/theme/exzed-rows.css`: under `html.theme-exzed` only, in the skin's roles only (no literal colour, alpha, radius, opacity, filter or shadow), every
 * hover on a button excluding a disabled one, the Row card's sizes (32px rows, 16px text, 32px buttons, the 2px group rule), and the parts the card draws as pixels (handle, ⓘ, ✎, bin, ↗, the
 * ▶ pointer, the chevrons).
 */
const FILE = 'styles/theme/exzed-rows.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-rows.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s list rows', () => {
  it('is a stylesheet main.tsx imports after the helpers', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-rows\.css'/)
    expect(main.indexOf('exzed-rows.css')).toBeGreaterThan(main.indexOf('exzed-helpers.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(40)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('every hover rule on a button excludes a disabled one', () => {
    for (const selector of rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))) {
      if (/\.q-icon-btn[^ ]*:hover/.test(selector)) expect(selector, selector).toContain(':where(:not(:disabled))')
    }
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour, and only the Row card’s sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '6', '8', '16', '20', '24', '32', '56']).toContain(size)
  })

  it('draws a row as 32px and flat, a group head 32px with the 2px frame rule on an opaque paper', () => {
    expect(body('html.theme-exzed .q-item')).toMatch(/height:\s*32px;[^}]*border-bottom:\s*0;/)
    expect(body('html.theme-exzed .q-group')).toMatch(/height:\s*32px;[^}]*border-bottom:\s*2px solid var\(--zx-frame\);\s*background:\s*var\(--zx-paper\);/)
  })

  it('makes the hovered row the highlight, everything in it its ink, and the button under the pointer an ink block', () => {
    expect(body('html.theme-exzed .q-item[data-pointer]')).toMatch(/background:\s*var\(--zx-hl-bg\);\s*color:\s*var\(--zx-hl-ink\);/)
    expect(body('html.theme-exzed .q-group[data-pointer]')).toMatch(/background:\s*var\(--zx-hl-bg\);/)
    // The button under the pointer: the row buttons, a platform chip and the add chip, in an item or a group head.
    const lit = rules().find(([list]) => list.includes('.q-icon-btn.row:where(:not(:disabled)):hover'))
    expect(lit?.[1]).toMatch(/background:\s*var\(--zx-hl-ink\);\s*color:\s*var\(--zx-hl-bg\);/)
    expect(lit?.[0]).toContain('.q-plat:where(:not(:disabled):not(.readonly)):hover')
  })

  it('draws the handle, the row buttons, the pointer and the chevrons as the board’s pixels, in the text colour', () => {
    expect(body('html.theme-exzed .q-handle::before')).toMatch(/width:\s*16px;\s*height:\s*16px;\s*background:\s*currentColor;[^}]*mask:\s*url/)
    expect(body('html.theme-exzed .q-item .q-icon-btn.row::before')).toMatch(/background:\s*currentColor;[^}]*mask:\s*var\(--icon\)/)
    for (const selector of ['html.theme-exzed .q-item .q-icon-btn.row.info', 'html.theme-exzed .q-item .q-icon-btn.row.edit', 'html.theme-exzed .q-item .q-icon-btn.row.remove', 'html.theme-exzed .q-item .q-icon-btn.row.link']) {
      expect(body(selector), selector).toMatch(/--icon:\s*url\("data:image\/svg\+xml/)
    }
    expect(body('html.theme-exzed .q-item::before')).toMatch(/visibility:\s*hidden;/)
    expect(body('html.theme-exzed .q-item:focus-visible::before')).toMatch(/visibility:\s*visible;/)
    expect(body('html.theme-exzed .q-chev::before')).toMatch(/background:\s*currentColor;[^}]*mask:\s*url/)
    expect(css).toMatch(/\.q-group\[aria-expanded='false'\] \.q-chev::before/)
  })

  it('draws the group line of the "Enhance group arrows" setting (D24) and the drop target’s dim highlight (D23)', () => {
    expect(body('html.theme-exzed .q-chev > .q-chev-rule')).toMatch(/display:\s*block;\s*left:\s*-6px;\s*top:\s*0;\s*width:\s*2px;\s*height:\s*16px;\s*background:\s*var\(--zx-ink2\);\s*transition:\s*none;/)
    expect(body("html.theme-exzed .q-group[aria-expanded='false'] .q-chev > .q-chev-rule")).toMatch(/left:\s*0;\s*top:\s*20px;\s*width:\s*16px;\s*height:\s*2px;/)
    expect(body('html.theme-exzed .q-group.is-target')).toMatch(/background:\s*var\(--zx-dim-bg\);\s*color:\s*var\(--zx-dim-ink\);/)
  })

  it('a row button is 32x32 and borderless', () => {
    expect(body('html.theme-exzed .q-item .q-icon-btn.row')).toMatch(/width:\s*32px;\s*height:\s*32px;[^}]*border:\s*0;/)
  })
})
