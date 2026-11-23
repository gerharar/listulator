import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * The smaller layers' gutters under eX-Zed (57.7c, design's D57 and D58): `styles/theme/exzed-layer-gutters.css` (Settings and the Preview) and Choose Your Fighter's body and scene in
 * `exzed-art.css`. Every rule under `html.theme-exzed`, only padding (and the one margin), every number even (X-004).
 */
const css = read('styles/theme/exzed-layer-gutters.css')
const rules = [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()] as const)
const art = read('styles/theme/exzed-art.css')

describe('eX-Zed’s smaller layers’ gutters', () => {
  it('is for eX-Zed only and sets padding and one margin, nothing else', () => {
    expect(rules.length).toBe(5)
    for (const [selector, body] of rules) {
      expect(selector, selector).toMatch(/^html\.theme-exzed \.q-/)
      expect(body, selector).toMatch(/^(padding|margin-top):[^;]+;$/)
    }
  })

  it('takes Settings and the Preview to 24px at the sides, the footer’s 12px unchanged', () => {
    const body = (selector: string) => rules.find(([name]) => name === `html.theme-exzed ${selector}`)?.[1]
    expect(body('.q-settings-body')).toBe('padding: 24px;')
    expect(body('.q-preview-head')).toBe('padding: 24px 24px 0;')
    expect(body('.q-preview-body')).toBe('padding: 0 24px;')
    expect(body('.q-preview-body > .q-error-block')).toBe('margin-top: 24px;')
    expect(body('.q-preview-footer')).toBe('padding: 12px 24px;')
  })

  it('takes Choose Your Fighter’s body to 24px with no bottom, and the scene takes back exactly that', () => {
    expect(art).toMatch(/html\.theme-exzed \.q-picker-body\s*{[^}]*padding:\s*24px 24px 0;/)
    expect(art).toMatch(/html\.theme-exzed \.q-scene\s*{[^}]*margin:\s*auto -24px 0;/)
  })

  it('uses only even numbers: every measure is a multiple of 2px (X-004)', () => {
    for (const [, size] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(\d+)px/g)) expect(Number(size) % 2, `${size}px`).toBe(0)
  })
})
