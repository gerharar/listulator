import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's notices (51.10, X-007), `styles/theme/exzed-notices.css`: under `html.theme-exzed` only, in the skin's roles only, the Toast and Banner cards' sizes (2px borders, 16px type on 24px lines, the 52px toast,
 * the 24px banner buttons, 8px and 16px gaps), the toast's one FLASH step (320ms, `steps(1)`, once, off under reduced motion), and no shadow, alpha, radius, opacity, filter or fill of its own (the toast's ring is
 * `--e-toast`).
 */
const FILE = 'styles/theme/exzed-notices.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-notices.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}@]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s notices', () => {
  it('is a stylesheet main.tsx imports after the popovers', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-notices\.css'/)
    expect(main.indexOf('exzed-notices.css')).toBeGreaterThan(main.indexOf('exzed-popover.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules()
      .filter(([list]) => !/^\d+%$/.test(list))
      .flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(15)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour of its own, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '8', '16', '24', '52']).toContain(size)
  })

  it('draws the toast: a 2px frame-hi border on paper, 16px ink on 24px lines, 16px gaps, 52px high, 4px 4px 4px 16px', () => {
    expect(body('html.theme-exzed .q-toast')).toMatch(/gap:\s*16px;\s*min-height:\s*52px;\s*padding:\s*4px 4px 4px 16px;\s*border:\s*2px solid var\(--zx-frame-hi\);\s*background:\s*var\(--zx-paper\);\s*color:\s*var\(--zx-ink\);\s*font-size:\s*16px;\s*font-weight:\s*400;\s*line-height:\s*24px;/)
    expect(body('html.theme-exzed .q-toast:not(:has(.q-btn))')).toMatch(/padding-right:\s*16px;/)
  })

  it('flashes the toast once, in 320ms with one step, and not under reduced motion', () => {
    expect(body('html.theme-exzed .q-toast.fixed')).toMatch(/animation:\s*zx-toast-flash 320ms steps\(1\) 1;/)
    expect(body('html.theme-exzed .q-toast.fixed .q-btn')).toMatch(/animation:\s*zx-toast-flash-ink 320ms steps\(1\) 1;/)
    expect(css).toMatch(/html\.theme-exzed\[data-reduced\] \.q-toast\.fixed,\s*html\.theme-exzed\[data-reduced\] \.q-toast\.fixed \.q-btn\s*{\s*animation:\s*none;/)
    expect(css).toMatch(/@keyframes zx-toast-flash\s*{\s*0%\s*{\s*background-color:\s*var\(--zx-acc\);\s*color:\s*var\(--zx-acc-ink\);/)
  })

  it('draws the Banner with an info-line border and no fill, and its buttons the card’s 24px', () => {
    expect(body('html.theme-exzed .q-banner')).toMatch(/padding:\s*2px 2px 2px 16px;\s*border:\s*2px solid var\(--zx-info-line\);\s*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-banner .q-btn')).toMatch(/height:\s*24px;\s*padding:\s*0 8px;/)
    expect(body('html.theme-exzed .q-banner-actions')).toMatch(/gap:\s*8px;/)
  })

  it('draws the strip and the block with a 2px frame border and no fill; neither is red', () => {
    expect(body('html.theme-exzed .q-error-strip')).toMatch(/border:\s*2px solid var\(--zx-frame\);\s*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-error-block')).toMatch(/gap:\s*8px;\s*padding:\s*16px;\s*border:\s*2px solid var\(--zx-frame\);\s*background:\s*transparent;/)
    expect(body('html.theme-exzed .q-error-block p')).toMatch(/color:\s*var\(--zx-ink2\);/)
    expect(css).not.toMatch(/--zx-danger/)
  })

  it('draws the refusal with the ! icon (an 8x8 bar and dot, 16px) in ink2 in place of the stock glyph', () => {
    expect(body('html.theme-exzed .q-import-refusal svg')).toMatch(/display:\s*none;/)
    expect(body('html.theme-exzed .q-import-refusal::before')).toMatch(/width:\s*16px;\s*height:\s*16px;\s*background:\s*var\(--zx-ink2\);/)
    expect(css).toMatch(/M3 0h2v5H3zM3 6h2v2H3z/)
  })
})
