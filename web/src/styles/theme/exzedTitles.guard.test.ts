import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's titles, window heads and wordmarks (51.1b, X-007), `styles/theme/exzed-titles.css`: the six screen titles at 32px with the three-band gradient, a list's name,
 * a sheet's title and the Preview's at 24px plain `ink`, the card's head gutters and inset rule, the wordmark at 24 and 32px with LIST on the skin's block. Under
 * `html.theme-exzed` only, in the skin's roles only, with none of the things eX-Zed has no use for (design, X-004), and with no size but the type scale (16, 24, 32) and the grid.
 */
const FILE = 'styles/theme/exzed-titles.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-titles.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().find(([list]) => list.split(',').map((s) => s.trim()).includes(selector))?.[1] ?? ''

describe('eX-Zed’s titles', () => {
  it('is a stylesheet main.tsx imports after the foundation', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-titles\.css'/)
    expect(main.indexOf('exzed-titles.css')).toBeGreaterThan(main.indexOf('exzed-components.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('draws the six screen titles at 32px on a 32px line with the gradient `t1` to 30%, `t2` to 62%, `t3` below, clipped to the letters', () => {
    for (const selector of ['.q-home-title', '.q-picker-title', '.q-create-title', '.q-vb-title', '.q-settings-title', '.q-about-title']) {
      const rule = body(`html.theme-exzed ${selector}`)
      expect(rule, selector).toMatch(/font-size:\s*32px;/)
      expect(rule, selector).toMatch(/line-height:\s*32px;/)
      expect(rule, selector).toMatch(/font-weight:\s*400;/)
      expect(rule, selector).toMatch(/background:\s*linear-gradient\(var\(--zx-t1\) 0 30%,\s*var\(--zx-t2\) 30% 62%,\s*var\(--zx-t3\) 62%\);/)
      expect(rule, selector).toMatch(/-webkit-background-clip:\s*text;/)
      expect(rule, selector).toMatch(/background-clip:\s*text;/)
      expect(rule, selector).toMatch(/color:\s*transparent;/)
    }
  })

  it('draws a list’s name, the Preview’s title and a sheet’s title at 24px plain `ink`, no gradient', () => {
    for (const [selector, line] of [['.q-list-title', '24px'], ['.q-preview-title', '32px'], ['.q-sheet-title', '32px']] as const) {
      const rule = body(`html.theme-exzed ${selector}`)
      expect(rule, selector).toMatch(/font-size:\s*24px;/)
      expect(rule, selector).toMatch(new RegExp(`line-height:\\s*${line};`))
      expect(rule, selector).toMatch(/font-weight:\s*400;/)
      expect(rule, selector).toMatch(/color:\s*var\(--zx-ink\);/)
      expect(rule, selector).not.toMatch(/gradient|background/)
    }
  })

  it('gives the heads the card’s gutters (24px above and at the sides, 16px below) and the 2px `frame` rule 24px in from each side', () => {
    expect(body('html.theme-exzed .q-picker-head')).toMatch(/padding:\s*24px 24px 16px;/)
    expect(body('html.theme-exzed .q-picker-head')).toMatch(/border-bottom:\s*0;/)
    expect(body('html.theme-exzed .q-settings-head::after')).toMatch(/left:\s*24px;[\s\S]*right:\s*24px;[\s\S]*height:\s*2px;[\s\S]*background:\s*var\(--zx-frame\);/)
    expect(body('html.theme-exzed .q-create-head')).toMatch(/padding:\s*24px 24px 0;/)
  })

  it('draws the wordmark at 24px (32px as `lg`) with LIST on the skin’s block in the skin’s ink', () => {
    expect(body('html.theme-exzed .q-wordmark')).toMatch(/font-size:\s*24px;[\s\S]*line-height:\s*24px;/)
    expect(body('html.theme-exzed .q-wordmark.lg')).toMatch(/font-size:\s*32px;[\s\S]*line-height:\s*32px;/)
    expect(body('html.theme-exzed .q-wordmark > b')).toMatch(/background:\s*var\(--zx-skin\);[\s\S]*color:\s*var\(--zx-skin-ink\);/)
  })

  it('uses no shadow, alpha, radius, opacity, filter or literal colour, and only the type scale and the grid’s sizes', () => {
    expect(css).not.toMatch(/box-shadow|text-shadow|border-radius|opacity|filter|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '2', '4', '8', '16', '24', '32']).toContain(size)
  })
})
