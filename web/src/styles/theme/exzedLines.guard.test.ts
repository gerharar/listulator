import { describe, expect, it } from 'vitest'
import { declarations, read, stylesheets } from './cssGuard.js'

/**
 * eX-Zed draws no 1px line (57.9c, design's D59 and D61, X-004), read at the source: no border or outline of any eX-Zed stylesheet is declared thinner than 2px (the computed side is the sweep's
 * rule `line` and `theme-exzed-lines.spec.ts`), and the two stylesheets of 57.9c and 57.9d are for eX-Zed alone.
 */
const theme = stylesheets().filter((path) => path.startsWith('styles/theme/exzed-') && path.endsWith('.css'))

/** The declarations of `exzed-platform-panel.css` whose rule names `selector` among its (comma-separated) selectors. */
const panel = (selector: string) => declarations(read('styles/theme/exzed-platform-panel.css')).filter((d) => d.selector.split(',').map((part) => part.trim()).includes(`html.theme-exzed ${selector}`))
const value = (selector: string, property: string) => panel(selector).find((d) => d.property === property)?.value

describe('the Platform panel’s lines that no captured state reaches (57.9d: the source row, the foot lines)', () => {
  it('sets the foot lines, the sub line and the source row at 16px, weight 400, no letter-spacing', () => {
    for (const selector of ['.q-platpanel-foot', '.q-platpanel-sub', '.q-platpanel-source span']) {
      expect(value(selector, 'font-size'), `${selector} size`).toBe('16px')
      expect(value(selector, 'font-weight'), `${selector} weight`).toBe('400')
      expect(value(selector, 'letter-spacing'), `${selector} spacing`).toBe('0')
      expect(value(selector, 'line-height'), `${selector} leading`).toBe('24px')
    }
  })

  it('draws the source row in ink2, as D61 says', () => {
    expect(value('.q-platpanel-source span', 'color')).toBe('var(--zx-ink2)')
  })

  it('draws Reset to source as a bracketed button (D62): 40px, no box at rest, ctl, 16px at weight 400, the acc block on hover; the brackets have an empty alternative text', () => {
    expect(value('.q-platpanel-source button', 'border')).toBe('2px solid transparent')
    expect(value('.q-platpanel-source button', 'color')).toBe('var(--zx-ctl)')
    expect(value('.q-platpanel-source button', 'height')).toBe('40px')
    expect(panel('.q-platpanel-source button::before').map((d) => d.value)).toEqual(["'['", "'[' / ''"])
    expect(panel('.q-platpanel-source button::after').map((d) => d.value)).toEqual(["']'", "']' / ''"])
    expect(value('.q-platpanel-source button:where(:not(:disabled)):hover', 'background')).toBe('var(--zx-hl-bg)')
    expect(value('.q-platpanel-source button', 'font-size')).toBe('16px')
    expect(value('.q-platpanel-source button', 'font-weight')).toBe('400')
  })
})

describe('eX-Zed’s stylesheets draw no line thinner than 2px', () => {
  it('declares no border or outline width of 1px (or less)', () => {
    const thin = theme.flatMap((path) =>
      declarations(read(path))
        .filter((d) => /^(border|outline)(-(top|right|bottom|left))?(-width)?$/.test(d.property) && /(^|\s)(0?\.\d+|1)px\b/.test(d.value))
        .map((d) => `${path}: ${d.selector} { ${d.property}: ${d.value} }`),
    )
    expect(thin).toEqual([])
  })

  it('keeps the new stylesheets under html.theme-exzed', () => {
    for (const path of ['styles/theme/exzed-lines.css', 'styles/theme/exzed-platform-panel.css']) {
      const selectors = [...read(path).matchAll(/([^{}]+){[^{}]*}/g)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()))
      expect(selectors.length, path).toBeGreaterThan(5)
      for (const selector of selectors) expect(selector, `${path}: ${selector}`).toMatch(/^html\.theme-exzed\b/)
    }
  })
})
