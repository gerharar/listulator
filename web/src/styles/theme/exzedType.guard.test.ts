import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, read } from './cssGuard.js'

/**
 * eX-Zed's swept type (51.12, X-007), `styles/theme/exzed-type.css`: under `html.theme-exzed` only, and nothing in it but the three sizes the theme has (16, 24, 32px), weight 400, no letter-spacing, and lines on
 * the 8px grid (16, 24 or 32px); no bold, no literal colour, no shadow, alpha or filter.
 */
const FILE = 'styles/theme/exzed-type.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-type.css'))
const css = exists ? read(FILE) : ''
const decls = exists ? declarations(css) : []

describe('eX-Zed’s swept type', () => {
  it('is a stylesheet main.tsx imports after the sheets', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-type\.css'/)
    expect(main.indexOf('exzed-type.css')).toBeGreaterThan(main.indexOf('exzed-sheets.css'))
  })

  it('applies to eX-Zed only', () => {
    expect(decls.length).toBeGreaterThan(15)
    for (const d of decls) for (const selector of d.selector.split(',')) expect(selector.trim(), selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('sets only 16, 24 and 32px type at weight 400 with no letter-spacing, on lines of 16, 24 or 32px', () => {
    const only = (property: string, allowed: readonly string[]) => {
      const values = decls.filter((d) => d.property === property).map((d) => d.value)
      expect(values.length, property).toBeGreaterThan(0)
      for (const value of values) expect(allowed, `${property}: ${value}`).toContain(value)
    }
    only('font-size', ['16px', '24px'])
    only('font-weight', ['400'])
    only('letter-spacing', ['0'])
    only('line-height', ['16px', '24px', '32px'])
  })

  it('draws no colour, shadow, alpha or filter of its own', () => {
    expect(css).not.toMatch(/rgba?\(|hsla?\(|#[0-9a-f]{3,8}\b|box-shadow|opacity\s*:|[;{\s]filter\s*:|color\s*:/i)
  })

  it('leaves no bold element: `b` and `strong` are weight 400', () => {
    const selectors = decls.filter((d) => d.property === 'font-weight' && d.value === '400').map((d) => d.selector)
    expect(selectors.some((selector) => selector.includes('html.theme-exzed b') && selector.includes('html.theme-exzed strong'))).toBe(true)
  })
})
