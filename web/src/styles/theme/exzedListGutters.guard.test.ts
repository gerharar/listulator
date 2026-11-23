import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * The list screen's gutters under eX-Zed (57.7b, design's D57 and D58), `styles/theme/exzed-list-gutters.css`: every rule under `html.theme-exzed`, every number a whole step of the
 * theme's 8px grid (the filter bar's 12px and the error strip's 10px are 2px steps, as D58 asks), and nothing but padding.
 */
const css = read('styles/theme/exzed-list-gutters.css')
const rules = [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!.trim()] as const)

describe('eX-Zed’s list screen gutters', () => {
  it('is for eX-Zed only and sets padding and nothing else', () => {
    expect(rules.length).toBe(5)
    for (const [selector, body] of rules) {
      expect(selector, selector).toMatch(/^html\.theme-exzed \.q-/)
      expect(body, selector).toMatch(/^padding:[^;]+;$/)
    }
  })

  it('takes the head, the filter bar, the rows’ area, the progress row and the error strip to 24px at the sides', () => {
    const padding = (selector: string) => rules.find(([name]) => name === `html.theme-exzed ${selector}`)?.[1]
    expect(padding('.q-list-head')).toBe('padding: 24px 24px 0;')
    expect(padding('.q-filterbar')).toBe('padding: 12px 24px;')
    expect(padding('.q-list-body')).toBe('padding: 0 24px 24px;')
    expect(padding('.q-list-progress')).toBe('padding: 24px;')
    expect(padding('.q-list-error')).toBe('padding: 10px 24px 0;')
  })

  it('uses only even numbers: every measure is a multiple of 2px (X-004)', () => {
    for (const [, size] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(\d+)px/g)) expect(Number(size) % 2, `${size}px`).toBe(0)
  })
})
