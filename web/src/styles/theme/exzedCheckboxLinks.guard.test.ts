import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's checkbox and links (51.5, X-007), `styles/theme/exzed-checkbox-links.css`: under `html.theme-exzed` only, in the skin's roles only (no literal colour, alpha, radius, opacity,
 * filter or shadow), the Checkbox card's sizes, and the interim dotted outline round Settings' disabled row (50.13) gone now that the box itself carries the disabled look.
 */
const FILE = 'styles/theme/exzed-checkbox-links.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-checkbox-links.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])

describe('eX-Zed’s checkbox and links', () => {
  it('is a stylesheet main.tsx imports after the fields', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-checkbox-links\.css'/)
    expect(main.indexOf('exzed-checkbox-links.css')).toBeGreaterThan(main.indexOf('exzed-fields.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(25)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('draws the box (16px, 2px frame border on paper, the chip-ink cell), the tick and dash in ink, and a disabled row’s box dotted with an ink2 tick', () => {
    expect(css).toMatch(/\.q-done > span\s*{[^}]*width:\s*16px;[^}]*border:\s*2px solid var\(--zx-frame\);[^}]*background:\s*var\(--zx-paper\);[^}]*outline:\s*2px solid var\(--zx-chip-ink\);/)
    expect(css).toMatch(/\.q-settings-check input:checked::after\s*{[^}]*background:\s*var\(--zx-ink\);/)
    expect(css).toMatch(/\.q-done\[aria-checked='mixed'\] > span::after\s*{\s*left:\s*2px;\s*top:\s*5px;\s*width:\s*8px;\s*height:\s*2px;\s*background:\s*var\(--zx-ink\);/)
    expect(css).toMatch(/input\[type='checkbox'\]:disabled\s*{[^}]*background:\s*var\(--zx-dotted\), var\(--zx-paper\);/)
    expect(css).toMatch(/input:disabled:checked::after\s*{\s*background:\s*var\(--zx-ink2\);/)
    expect(css).toMatch(/\.q-item\.is-done \.title\s*{[^}]*color:\s*var\(--zx-ink2\);[^}]*text-decoration-thickness:\s*2px;/)
  })

  it('a text link is one inline-block box in its sentence’s own size and weight, so its ↗ is under the highlight (found at Checkpoint G2: Quantum’s 12.5px and 500 had been left on it)', () => {
    const rule = rules().find(([list]) => list.includes('.q-keycard-link') && list.includes('.q-list-linkback a') && !list.includes(':hover') && !list.includes('aria-hidden'))
    expect(rule, 'the text links’ own rule').toBeDefined()
    expect(rule![0]).toContain('html.theme-exzed .q-about-link')
    expect(rule![1]).toMatch(/display:\s*inline-block;\s*padding-top:\s*2px;\s*padding-right:\s*2px;\s*font-size:\s*inherit;\s*font-weight:\s*inherit;\s*line-height:\s*inherit;/)
    expect(css).toMatch(/html\.theme-exzed \.q-about-link\s*{\s*justify-self:\s*start;/)
  })

  it('a hover that highlights a setting’s line excludes a disabled one', () => {
    for (const [selector] of rules().filter(([list]) => list.includes('.q-settings-check') && list.includes(':hover'))) expect(selector).toContain(':where(:not(:has(input:disabled)))')
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '5', '8', '16']).toContain(size)
  })

  it('no longer draws the interim dotted outline round the disabled Show Spectrum border row (50.13)', () => {
    const settings = readFileSync(join(import.meta.dirname, '..', '..', 'screens', 'settings', 'SettingsScreen.css'), 'utf8')
    expect(settings).not.toMatch(/outline:\s*2px dotted/)
    expect(settings).not.toContain('data-disabled')
  })
})
