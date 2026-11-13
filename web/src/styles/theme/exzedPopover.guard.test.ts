import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's popovers (51.9, X-007), `styles/theme/exzed-popover.css`: under `html.theme-exzed` only, in the skin's roles only, the Popover card's sizes (2px border, 16px padding, the 16x10 tail, the 400px
 * joined panel), the tail drawn in the border's colour with `paper` inside, the skin button lit like the other openers, and no shadow, alpha, radius, opacity or filter of its own (the ring is `--e-pop`).
 */
const FILE = 'styles/theme/exzed-popover.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-popover.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s popovers', () => {
  it('is a stylesheet main.tsx imports after the About rows', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-popover\.css'/)
    expect(main.indexOf('exzed-popover.css')).toBeGreaterThan(main.indexOf('exzed-about-rows.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(15)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour of its own, and only the card’s sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '8', '10', '12', '16', '24', '400']).toContain(size)
  })

  it('draws the box (2px frame-hi border, 16px padding, 24px leading) and the staircase tail in the border’s colour with paper inside', () => {
    expect(body('html.theme-exzed .q-pop')).toMatch(/padding:\s*16px;\s*border:\s*2px solid var\(--zx-frame-hi\);\s*background:\s*var\(--zx-paper\);[^}]*line-height:\s*24px;/)
    expect(body('html.theme-exzed .q-pop-tail-rim')).toMatch(/fill:\s*var\(--zx-frame-hi\);/)
    expect(body('html.theme-exzed .q-pop-tail-fill')).toMatch(/fill:\s*var\(--zx-paper\);/)
    expect(body('html.theme-exzed .q-pop-tail.up')).toMatch(/top:\s*-10px;/)
    expect(body('html.theme-exzed .q-pop-tail.down')).toMatch(/bottom:\s*-10px;/)
    expect(css).toMatch(/\.q-pop-tail\.up,\s*html\.theme-exzed \.q-pop-tail\.down\s*{\s*width:\s*16px;\s*height:\s*10px;/)
  })

  it('lights the skin button like the other openers, its swatch rim included, and its hover excludes a disabled button', () => {
    expect(css).toMatch(/\.q-skin-btn:where\(:not\(:disabled\)\):hover,\s*html\.theme-exzed \.q-skin-btn\[aria-expanded='true'\]\s*{\s*background:\s*var\(--zx-hl-bg\);/)
    expect(css).toMatch(/\.q-skin-btn\[aria-expanded='true'\] \.q-zx-swatch\s*{\s*border-color:\s*var\(--zx-hl-ink\);/)
  })

  it('joins the Platform panel: a 400px box with the same frame', () => {
    expect(body('html.theme-exzed .q-platpanel')).toMatch(/width:\s*400px;[^}]*padding:\s*16px;\s*border:\s*2px solid var\(--zx-frame-hi\);\s*background:\s*var\(--zx-paper\);/)
  })
})
