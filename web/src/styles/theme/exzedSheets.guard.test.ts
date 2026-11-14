import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's helper sheets (51.11, X-007), `styles/theme/exzed-sheets.css`: under `html.theme-exzed` only, in the skin's roles only, the Sheet card's and the Home-Helpers board's sizes (the 800px sheet 24px in, the
 * 2px rules, 16px and 24px of padding, the 40x56 dials), the scrim the 51.1 token over the lists under the row, the ✕ drawn in pixels, and no shadow (the sheet's ring is `--e-sheet`), alpha, radius, opacity
 * or filter of its own.
 */
const FILE = 'styles/theme/exzed-sheets.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-sheets.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}@]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s helper sheets', () => {
  it('is a stylesheet main.tsx imports after the motion', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-sheets\.css'/)
    expect(main.indexOf('exzed-sheets.css')).toBeGreaterThan(main.indexOf('exzed-motion.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(30)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour of its own, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b|opacity\s*:|[;{\s]filter\s*:/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '8', '12', '16', '24', '32', '40', '48', '56', '420', '800']).toContain(size)
  })

  it('hangs the sheet 24px in and 16px under the row, 800px wide, in the single frame', () => {
    expect(body('html.theme-exzed .q-help-anchor .q-sheet')).toMatch(/top:\s*16px;\s*left:\s*24px;\s*right:\s*auto;\s*width:\s*800px;\s*max-width:\s*calc\(100% - 48px\);\s*border:\s*2px solid var\(--zx-frame-hi\);\s*background:\s*var\(--zx-paper\);/)
  })

  it('puts the scrim token under the sheet, over the lists, down the room the sheet has, with its own default for that room', () => {
    expect(body('html.theme-exzed .q-help-anchor::before')).toMatch(/position:\s*absolute;\s*top:\s*0;\s*left:\s*0;\s*width:\s*100%;\s*height:\s*var\(--help-room\);\s*background:\s*var\(--zx-scrim\);/)
    expect(body('html.theme-exzed .q-help-anchor')).toMatch(/--help-room:\s*420px;/)
  })

  it('draws the head with a 2px frame rule, and the ✕ as the card’s 8x8 pixel icon at 16px', () => {
    expect(body('html.theme-exzed .q-sheet-head')).toMatch(/padding:\s*16px 16px 16px 24px;\s*border-bottom:\s*2px solid var\(--zx-frame\);/)
    expect(body('html.theme-exzed .q-sheet-head .q-icon-btn::before')).toMatch(/width:\s*16px;\s*height:\s*16px;\s*background:\s*currentColor;/)
    expect(css).toMatch(/M0 0h2v1H0zM6 0h2v1H6zM1 1h2v1H1z/)
  })

  it('draws the dials 40x56 with a 2px frame, the settled ones the acc block, and does not shake them', () => {
    expect(body('html.theme-exzed .q-digit')).toMatch(/width:\s*40px;\s*height:\s*56px;\s*border:\s*2px solid var\(--zx-frame\);/)
    expect(body('html.theme-exzed .q-digit.on')).toMatch(/background:\s*var\(--zx-acc\);\s*color:\s*var\(--zx-acc-ink\);/)
    expect(body('html.theme-exzed .q-digit.ticking')).toMatch(/animation:\s*none;/)
  })

  it('draws the help row’s rule as a 2px frame line 24px in, and the Home banner 24px in under it', () => {
    expect(body('html.theme-exzed .q-help-row')).toMatch(/margin:\s*0 24px;\s*padding:\s*8px 0;\s*border-bottom:\s*2px solid var\(--zx-frame\);/)
    expect(body('html.theme-exzed .q-home > .q-banner')).toMatch(/margin:\s*8px 24px 0;/)
  })
})
