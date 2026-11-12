import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's component foundation (Phase 51, 51.1, X-007): the shared pieces every component of the theme draws with, in `styles/theme/exzed-components.css`: the highlight
 * and the dim highlight as custom properties (hover, lit, picked, pulse read them), the dotted outline (a disabled thing), the scrim's checkerboard and the category head's
 * dither as reusable backgrounds, kickers in `lab`, `cursor: not-allowed` for a disabled control. Nothing here may reach Quantum, and nothing here may use a shadow, an alpha,
 * a radius, an opacity or a filter (design, X-004: none of them exist in eX-Zed), a literal colour, or a size other than the 2px strokes of the grid.
 */
const FILE = 'styles/theme/exzed-components.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-components.css'))
const css = exists ? read(FILE) : ''

/** Every rule of the file as [selector list, body], at the top level (the file has no at-rules). */
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])

describe('eX-Zed’s component foundation', () => {
  it('is a stylesheet main.tsx imports after the colours, so it reads the skin’s roles', () => {
    expect(exists, 'styles/theme/exzed-components.css exists').toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-components\.css'/)
    expect(main.indexOf('exzed-components.css')).toBeGreaterThan(main.indexOf('exzed-colours.css'))
  })

  it('applies to eX-Zed only: every selector is under `html.theme-exzed`', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(3)
    for (const selector of selectors) expect(selector, selector).toMatch(/^(?::where\()?html\.theme-exzed\b/)
  })

  it('defines the highlight and the dim highlight from the skin’s roles, and the dotted, scrim and dither backgrounds from theirs', () => {
    expect(css).toMatch(/--zx-hl-bg:\s*var\(--zx-acc\);/)
    expect(css).toMatch(/--zx-hl-ink:\s*var\(--zx-acc-ink\);/)
    expect(css).toMatch(/--zx-dim-bg:\s*var\(--zx-acc-dim\);/)
    expect(css).toMatch(/--zx-dim-ink:\s*var\(--zx-acc-ink\);/)
    // The dotted 2px outline of a disabled button: four edges, 2px dots on a 4px period, in `ink2` (design's bundle.css).
    const dotted = /--zx-dotted:([^;]+);/.exec(css)?.[1] ?? ''
    expect(dotted.match(/repeating-linear-gradient\(/g)?.length, 'four edges').toBe(4)
    expect(dotted.match(/var\(--zx-ink2\) 0 2px,\s*transparent 2px 4px/g)?.length).toBe(4)
    // The icon dither: every other 2px cell of a disabled icon, from its own top left (a mask: `chip-ink` is only its opacity).
    expect(css).toMatch(/--zx-icon-dither:\s*repeating-conic-gradient\(transparent 0 25%,\s*var\(--zx-chip-ink\) 0 50%\) 0 0\s*\/\s*4px 4px;/)
    // The scrim: a 2px checkerboard of black pixels over transparent; the head rule: `lab` over `paper`.
    expect(css).toMatch(/--zx-scrim:\s*repeating-conic-gradient\(var\(--zx-chip-ink\) 0 25%,\s*transparent 0 50%\) 0 0\s*\/\s*4px 4px;/)
    expect(css).toMatch(/--zx-dither-lab:\s*repeating-conic-gradient\(var\(--zx-lab\) 0 25%,\s*var\(--zx-paper\) 0 50%\) 0 0\s*\/\s*4px 4px;/)
  })

  it('draws kickers in `lab` capitals, a disabled control with `not-allowed` (a busy one keeps its own cursor), and the root with no bold and no letter-spacing', () => {
    const body = (selector: string) => rules().find(([list]) => list.split(',').map((s) => s.trim()).includes(selector))?.[1] ?? ''
    expect(body('html.theme-exzed .q-kicker')).toMatch(/color:\s*var\(--zx-lab\);/)
    expect(body('html.theme-exzed .q-kicker')).toMatch(/text-transform:\s*uppercase;/)
    expect(css).toMatch(/:disabled:not\(\[aria-busy='true'\]\)/)
    expect(css).toMatch(/\[aria-disabled='true'\]/)
    expect(css).toMatch(/cursor:\s*not-allowed;/)
    expect(body('html.theme-exzed')).toMatch(/font-weight:\s*400;/)
    expect(body('html.theme-exzed')).toMatch(/letter-spacing:\s*0;/)
  })

  it('uses no shadow, alpha, radius, opacity, filter or literal colour, and no px size but the grid’s 2px, 4px and the 4px pattern', () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|border-radius|opacity|filter|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4']).toContain(size)
  })
})
