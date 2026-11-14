import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * What the owner found at his first look at eX-Zed (51.13, X-007), `styles/theme/exzed-owner-look.css`: under `html.theme-exzed` only, in the skin's roles only, no shadow, alpha, radius, opacity, filter or
 * literal colour of its own, and every hover on a control that can be disabled keeps `:where(:not(:disabled))`.
 */
const FILE = 'styles/theme/exzed-owner-look.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-owner-look.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}@]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s fixes from the owner’s first look', () => {
  it('is a stylesheet main.tsx imports after the skins’ art', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-owner-look\.css'/)
    expect(main.indexOf('exzed-owner-look.css')).toBeGreaterThan(main.indexOf('exzed-art.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules().flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(10)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow, alpha, radius, opacity, filter or literal colour of its own', () => {
    expect(css).not.toMatch(/box-shadow|border-radius|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b/i)
  })

  it('keeps `:where(:not(:disabled))` on every hover of a control that can be disabled', () => {
    for (const [list] of rules()) {
      for (const selector of list.split(',').map((s) => s.trim())) {
        if (selector.includes(':hover') && !selector.includes(':not(:hover)')) expect(selector, selector).toContain(':where(:not(:disabled))')
      }
    }
  })

  it('makes the skin button’s caret follow the button, so it is not grey on the lit yellow', () => {
    expect(body('html.theme-exzed .q-skin-caret')).toMatch(/color:\s*inherit;/)
  })

  it('draws Hide Done and Fold All as chips: hover is the dim block, and Hide Done picked is the highlight', () => {
    expect(body('html.theme-exzed .q-hide-done:where(:not(:disabled)):hover')).toMatch(/background:\s*var\(--zx-dim-bg\);\s*border-color:\s*var\(--zx-dim-bg\);\s*color:\s*var\(--zx-dim-ink\);/)
    expect(body('html.theme-exzed .q-fold:where(:not(:disabled)):hover')).toMatch(/background:\s*var\(--zx-dim-bg\);/)
    expect(body("html.theme-exzed .q-hide-done[aria-pressed='true']")).toMatch(/background:\s*var\(--zx-hl-bg\);\s*border-color:\s*var\(--zx-hl-bg\);\s*color:\s*var\(--zx-hl-ink\);/)
  })

  it('lights the Tired Boss options and the example cards with the highlight', () => {
    for (const selector of ['html.theme-exzed .q-tired-picker .option:where(:not(:disabled)):hover', 'html.theme-exzed .q-vault-card:where(:not(:disabled)):hover']) {
      expect(body(selector), selector).toMatch(/background:\s*var\(--zx-hl-bg\);\s*border-color:\s*var\(--zx-hl-bg\);\s*color:\s*var\(--zx-hl-ink\);/)
    }
  })

  it('turns a focused field’s border blue on Lotus alone, where the accent is the frame’s own black', () => {
    expect(body("html.theme-exzed[data-theme='exzed-1l'] .q-filter-input:focus")).toMatch(/border-color:\s*var\(--zx-pri-hv-line\);/)
    expect(css).not.toMatch(/exzed-1[abcde]/)
  })

  it('draws a control at rest in `ctl`, not the secondary grey (design’s D47): Hide Done, Fold All, About’s chevron', () => {
    expect(body('html.theme-exzed .q-hide-done')).toMatch(/color:\s*var\(--zx-ctl\);/)
    expect(body('html.theme-exzed .q-fold')).toMatch(/color:\s*var\(--zx-ctl\);/)
    expect(body('html.theme-exzed .q-about-chevron')).toMatch(/color:\s*var\(--zx-ctl\);/)
  })

  it('gives a tile’s source line the category colour on Lotus alone, and not under the pointer', () => {
    expect(body("html.theme-exzed[data-theme='exzed-1l'] .q-tile:not(:hover) .q-tile-src")).toMatch(/color:\s*var\(--zx-ink\);/)
  })

  it('makes the toast as wide as its sentence, to the window less 16px a side, so a short sentence is one line', () => {
    expect(body('html.theme-exzed .q-toast.fixed')).toMatch(/width:\s*max-content;\s*max-width:\s*min\(620px, calc\(100vw - 32px\)\);/)
  })

  it('makes the list menu as wide as its longest row, never under the card’s 240px', () => {
    expect(body('html.theme-exzed .q-pop.w240:has(.q-kicker + .q-pop-menu)')).toMatch(/width:\s*max-content;\s*min-width:\s*240px;/)
  })

  it('keeps a name on one line, cut with an ellipsis, while Surprise Me’s dials spin', () => {
    expect(body('html.theme-exzed .q-reel:has(.q-digit.ticking) .q-reel-name > span')).toMatch(/overflow:\s*hidden;\s*text-overflow:\s*ellipsis;\s*white-space:\s*nowrap;/)
  })
})
