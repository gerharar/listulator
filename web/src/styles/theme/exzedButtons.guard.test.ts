import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's buttons (51.2a, X-007), `styles/theme/exzed-buttons.css`: the roles (primary, the bracketed secondary, danger), disabled, busy, lit and the icon buttons, on Quantum's own
 * classes. Under `html.theme-exzed` only, in the skin's roles only, with nothing eX-Zed has no use for (design, X-004), every hover rule excluding `:disabled` (the disabled-hover guard
 * reads it too), the brackets as CSS content with an empty alternative text, and only the Button card's sizes.
 */
const FILE = 'styles/theme/exzed-buttons.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-buttons.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])

describe('eX-Zed’s buttons', () => {
  it('is a stylesheet main.tsx imports after the titles', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-buttons\.css'/)
    expect(main.indexOf('exzed-buttons.css')).toBeGreaterThan(main.indexOf('exzed-titles.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(20)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('every hover rule excludes a disabled control', () => {
    for (const selector of rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))) {
      if (selector.includes(':hover')) expect(selector, selector).toContain(':where(:not(:disabled))')
    }
  })

  it('draws the brackets as CSS content with an empty alternative text, a fallback first for an engine that has none', () => {
    expect(css).toMatch(/::before\s*{\s*content:\s*'\[';\s*content:\s*'\[' \/ '';\s*}/)
    expect(css).toMatch(/::after\s*{\s*content:\s*'\]';\s*content:\s*'\]' \/ '';\s*}/)
  })

  it('draws a disabled button as the dotted outline at the box’s outer edge, a disabled icon as the dither mask, and a busy one with the progress cursor', () => {
    expect(css).toMatch(/\.q-btn:disabled:not\(\[aria-busy='true'\]\)\s*{[^}]*background:\s*var\(--zx-dotted\);[^}]*background-origin:\s*border-box;/)
    expect(css).toMatch(/\.q-icon-btn:disabled svg\s*{[^}]*mask:\s*var\(--zx-icon-dither\);/)
    expect(css).toMatch(/\.q-btn\[aria-busy='true'\]\s*{\s*cursor:\s*progress;\s*}/)
  })

  it('uses no shadow, alpha, radius, opacity, filter or literal colour, and only the Button card’s sizes (and the helpers’ 24px and their 10px separator gap)', () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|border-radius|opacity|filter|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '8', '10', '16', '24', '32', '40', '48']).toContain(size)
  })
})
