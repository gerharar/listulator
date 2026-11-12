import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's toggle chips, tabs and facet toggles (51.3, X-007), `styles/theme/exzed-chips.css`: under `html.theme-exzed` only, in the skin's roles only, every hover rule excluding
 * `:disabled`, only the ToggleChip and Tabs cards' sizes, and the retired parts really gone: Quantum's tab hover underline is no longer a shadow the sweep has to allow.
 */
const FILE = 'styles/theme/exzed-chips.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-chips.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])

describe('eX-Zed’s chips and tabs', () => {
  it('is a stylesheet main.tsx imports after the buttons', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-chips\.css'/)
    expect(main.indexOf('exzed-chips.css')).toBeGreaterThan(main.indexOf('exzed-buttons.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(15)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('every hover rule excludes a disabled control', () => {
    for (const selector of rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))) {
      if (selector.includes(':hover')) expect(selector, selector).toContain(':where(:not(:disabled))')
    }
  })

  it('draws a chip as a 40px box with a 2px frame border, the hover as the dim block and the picked one as the highlight, from the skin’s roles', () => {
    expect(css).toMatch(/\.q-facet button\s*{[^}]*height:\s*40px;[^}]*border:\s*2px solid var\(--zx-frame\);/)
    expect(css).toMatch(/:hover\s*{\s*background:\s*var\(--zx-dim-bg\);\s*border-color:\s*var\(--zx-dim-bg\);\s*color:\s*var\(--zx-dim-ink\);/)
    expect(css).toMatch(/\[aria-pressed='true'\][^{]*{\s*background:\s*var\(--zx-hl-bg\);\s*border-color:\s*var\(--zx-hl-bg\);\s*color:\s*var\(--zx-hl-ink\);/)
  })

  it('retires the joined bar and draws a tab without a bottom border', () => {
    expect(css).toMatch(/\.q-facet-seg\s*{\s*gap:\s*8px;\s*padding:\s*0;\s*}/)
    expect(css).toMatch(/\.q-tabs button\s*{[^}]*height:\s*40px;[^}]*border-bottom:\s*0;/)
  })

  it('uses no shadow but none, no alpha, radius, opacity, filter or literal colour, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/border-radius|opacity|filter|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) expect(value).toBe('none')
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '8', '12', '16', '40']).toContain(size)
  })
})

describe('Quantum’s tab hover underline', () => {
  it('is a background, not a shadow: the sweep for shadows has nothing to allow in TabStrip.css', () => {
    const tabs = readFileSync(join(import.meta.dirname, '..', '..', 'components', 'quantum', 'TabStrip', 'TabStrip.css'), 'utf8')
    expect(tabs).not.toMatch(/box-shadow:\s*inset/)
    expect(tabs).toMatch(/\.q-tabs button:hover\s*{[^}]*background-image:\s*linear-gradient\(var\(--line\), var\(--line\)\);[^}]*background-size:\s*100% 3px;/)
    const guard = readFileSync(join(import.meta.dirname, 'componentStyles.guard.test.ts'), 'utf8')
    expect(guard).not.toContain("components/quantum/TabStrip/TabStrip.css'")
  })
})
