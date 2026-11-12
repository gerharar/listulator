import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's fields and listboxes (51.4, X-007), `styles/theme/exzed-fields.css`: under `html.theme-exzed` only, in the skin's roles only (no literal colour, alpha, radius, opacity or
 * filter, no shadow of its own: the listbox's ring is the `--e-pop` token), every hover rule on a button excluding `:disabled`, and only the Field card's sizes.
 */
const FILE = 'styles/theme/exzed-fields.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-fields.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])

describe('eX-Zed’s fields and listboxes', () => {
  it('is a stylesheet main.tsx imports after the chips', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-fields\.css'/)
    expect(main.indexOf('exzed-fields.css')).toBeGreaterThan(main.indexOf('exzed-chips.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(30)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('draws a field as a 40px box with a 2px frame border on paper, focus as the acc border with no outline, and the listbox with the frame-hi border and 40px options', () => {
    expect(css).toMatch(/\.q-input,\s*html\.theme-exzed \.q-filter-input\s*{[^}]*height:\s*40px;[^}]*padding:\s*0 8px;[^}]*border:\s*2px solid var\(--zx-frame\);[^}]*background:\s*var\(--zx-paper\);/)
    expect(css).toMatch(/:focus-visible,[^{]*{\s*outline:\s*none;\s*border-color:\s*var\(--zx-acc\);/)
    expect(css).toMatch(/\.q-combo-list\s*{[^}]*border:\s*2px solid var\(--zx-frame-hi\);/)
    expect(css).toMatch(/\.q-combo-list li\s*{[^}]*min-height:\s*40px;/)
    expect(css).toMatch(/textarea\.q-input\s*{[^}]*min-height:\s*64px;[^}]*padding:\s*8px;/)
  })

  it('has no shadow of its own, no alpha, radius, opacity, filter or literal colour, and only the Field card’s sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '8', '10', '12', '16', '24', '32', '36', '40', '64', '88', '34', '46', '72', '184', '212']).toContain(size)
  })
})
