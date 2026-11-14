import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * eX-Zed's spinner, busy list and row pulse (51.11, X-007), `styles/theme/exzed-motion.css`: under `html.theme-exzed` only, in the skin's roles only, nothing that fades or eases (every animation is
 * one `steps(1)`), the spinner's eight cells in `ink`, `ink2` and `frame`, the scrim the 51.1 token with its 300ms delay on the busy state only, and no shadow, alpha, radius, opacity or filter.
 */
const FILE = 'styles/theme/exzed-motion.css'
const exists = existsSync(join(import.meta.dirname, 'exzed-motion.css'))
const css = exists ? read(FILE) : ''
const rules = (): [string, string][] => [...css.matchAll(/([^{}@]+){([^{}]*)}/g)].map((m) => [m[1]!.trim(), m[2]!])
const body = (selector: string) => rules().filter(([list]) => list.split(',').some((part) => part.trim() === selector)).map(([, declarations]) => declarations).join('')

describe('eX-Zed’s motion', () => {
  it('is a stylesheet main.tsx imports after the notices', () => {
    expect(exists).toBe(true)
    const main = readFileSync(join(import.meta.dirname, '..', '..', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import '\.\/styles\/theme\/exzed-motion\.css'/)
    expect(main.indexOf('exzed-motion.css')).toBeGreaterThan(main.indexOf('exzed-notices.css'))
  })

  it('applies to eX-Zed only', () => {
    const selectors = rules()
      .filter(([list]) => !/^\d+(\.\d+)?%$/.test(list))
      .flatMap(([list]) => list.split(',').map((s) => s.trim()))
    expect(selectors.length).toBeGreaterThan(15)
    for (const selector of selectors) expect(selector, selector).toMatch(/^html\.theme-exzed\b/)
  })

  it('has no shadow, alpha, opacity, filter, easing or literal colour, and only the cards’ sizes', () => {
    expect(css).not.toMatch(/box-shadow|opacity\s*:|[;{\s]filter\s*:|rgba?\(|hsla?\(|color-mix|#[0-9a-f]{3,8}\b|ease|linear|cubic-bezier/i)
    for (const [, size] of css.matchAll(/(\d+)px/g)) expect(['0', '4', '24']).toContain(size)
    expect(css.match(/border-radius:[^;]*/g)).toEqual(['border-radius: 0'])
  })

  it('draws the spinner’s eight cells: head ink, the two behind it ink2, the rest frame, a cell every 100ms in steps, off under reduced motion', () => {
    expect(body('html.theme-exzed .q-spinner')).toMatch(/width:\s*24px;\s*height:\s*24px;\s*border:\s*0;/)
    expect(body('html.theme-exzed .q-spinner rect')).toMatch(/fill:\s*var\(--zx-frame\);/)
    expect(body('html.theme-exzed .q-spinner rect:nth-child(1)')).toMatch(/fill:\s*var\(--zx-ink\);/)
    expect(body('html.theme-exzed .q-spinner rect:nth-child(7)')).toMatch(/fill:\s*var\(--zx-ink2\);/)
    expect(body('html.theme-exzed:not([data-reduced]) .q-spinner rect')).toMatch(/animation:\s*zx-spinner 800ms steps\(1\) infinite;/)
    for (let n = 2; n <= 8; n++) expect(body(`html.theme-exzed:not([data-reduced]) .q-spinner rect:nth-child(${n})`), `cell ${n}`).toMatch(new RegExp(`animation-delay:\\s*-${(9 - n) * 100}ms;`))
    expect(css).toMatch(/@keyframes zx-spinner\s*{\s*0%\s*{\s*fill:\s*var\(--zx-ink\);\s*}\s*12\.5%\s*{\s*fill:\s*var\(--zx-ink2\);\s*}\s*37\.5%\s*{\s*fill:\s*var\(--zx-frame\);/)
  })

  it('puts the scrim token over a busy list’s body, hidden at rest and shown after 300ms on the busy state only', () => {
    expect(body('html.theme-exzed .q-list-cols.q-hold::after')).toMatch(/background:\s*var\(--zx-scrim\);\s*visibility:\s*hidden;/)
    expect(body('html.theme-exzed .q-list-cols.q-hold.is-busy::after')).toMatch(/visibility:\s*visible;\s*transition-delay:\s*300ms;/)
    expect(body('html.theme-exzed .q-list:has(.q-hold.is-busy)')).toMatch(/cursor:\s*progress;/)
  })

  it('turns the refresh icon in four quarter turns in 800ms, and not under reduced motion', () => {
    expect(body('html.theme-exzed:not([data-reduced]) .q-spin')).toMatch(/animation:\s*q-spin 800ms steps\(4\) infinite;/)
    expect(body('html.theme-exzed:not([data-reduced]) .q-check-btn .q-spin')).toMatch(/animation:\s*q-spin 800ms steps\(4\) infinite;/)
  })

  it('turns Quantum’s pulse animation off', () => {
    expect(body('html.theme-exzed .q-item.pulse')).toMatch(/animation:\s*none;/)
    expect(body('html.theme-exzed .q-group.pulse')).toMatch(/animation:\s*none;/)
  })
})
