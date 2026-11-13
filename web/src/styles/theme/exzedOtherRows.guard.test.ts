import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * The stylesheets of 51.8 (X-007), the screens' rows other than the list's: My Lists, the Preview, the search results, the List Vault, the jump rail and About's data sources. Each is a file main.tsx
 * imports; every selector is under `html.theme-exzed`; they draw in the skin's roles only (no literal colour, alpha, radius, opacity, filter or shadow) and in the Row card's sizes; a hover on a
 * control excludes a disabled one (the Vault's empty category takes none, and the rail's folded strip and grip and About's TMDB row are not disableable).
 */
const FILES = ['home', 'preview', 'search', 'vault', 'rail', 'about-rows'] as const

describe.each(FILES)('exzed-%s.css (51.8)', (name) => {
  const file = `styles/theme/exzed-${name}.css`
  const css = existsSync(join(import.meta.dirname, `exzed-${name}.css`)) ? read(file) : ''
  const rules = [...css.matchAll(/([^{}]+){([^{}]*)}/g)].map((m): [string, string] => [m[1]!.trim(), m[2]!])

  it('is imported by main.tsx', () => {
    expect(css.length).toBeGreaterThan(0)
    expect(readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')).toContain(`./styles/theme/exzed-${name}.css`)
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules.flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(3)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow (but none), alpha, radius, opacity, filter or literal colour', () => {
    expect(css.replace(/box-shadow:\s*none/g, '')).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
  })

  it('every hover rule excludes a disabled control', () => {
    for (const selector of rules.flatMap(([list]) => list.split(',').map((s) => s.trim()))) {
      if (selector.includes(':hover') && !selector.includes('.q-about-tmdb') && !selector.includes('.q-vb-cat') && !/\.q-rail-(stub|fold|grip)/.test(selector)) expect(selector, selector).toContain(':where(:not(:disabled')
    }
  })
})

describe('the shared parts of the screens’ rows', () => {
  const css = (name: string) => read(`styles/theme/exzed-${name}.css`)

  it('draws the category head with a 4px dither of frame over paper', () => {
    expect(css('home')).toMatch(/\.q-kicker-bar::after\s*{[^}]*height:\s*4px;[^}]*repeating-conic-gradient\(var\(--zx-frame\) 0 25%, var\(--zx-paper\) 0 50%\) 0 0 \/ 4px 4px/)
  })

  it('makes every list row 32px (My Lists, the Preview, the Vault and the rail) and flat', () => {
    expect(css('home')).toMatch(/\.q-home-row\s*{\s*height:\s*32px;/)
    expect(css('preview')).toMatch(/\.q-preview-row\s*{\s*height:\s*32px;/)
    expect(css('vault')).toMatch(/\.q-vb-row\s*{\s*height:\s*32px;[^}]*border-bottom:\s*0;/)
    expect(css('rail')).toMatch(/\.q-rail-entry\s*{[^}]*height:\s*32px;/)
  })

  it('lets the picked Vault category be the highlight itself, with no stripe', () => {
    expect(css('vault')).toMatch(/\.q-vb-cat\.on,\s*html\.theme-exzed \.q-vb-cat\.on:hover\s*{\s*background:\s*var\(--zx-hl-bg\);\s*color:\s*var\(--zx-hl-ink\);\s*font-weight:\s*400;\s*box-shadow:\s*none;/)
  })
})
