import { describe, expect, it } from 'vitest'
import { declarations, read } from './cssGuard.js'

/**
 * The (?) under eX-Zed (57.10, rule 6; the Settings board and the Icons card): a 32x32 ghost button with a 2px transparent border (the board's `zx-ctl`), the pixel `help` icon in `ctl`, the
 * highlight block on hover and while its popover is open; the popover's text on the theme's 16px, no bold. The sweep reads it on the screens; this reads the stylesheet, so a rule that
 * moves it back to Quantum's 20px line-icon button fails here, with its name.
 */
const FILE = 'styles/theme/exzed-help.css'

const of = (selector: string): Record<string, string> =>
  Object.fromEntries(
    declarations(read(FILE))
      .filter((d) => d.selector.split(',').some((part) => part.trim() === selector))
      .map((d) => [d.property, d.value]),
  )

describe('the (?) buttons in eX-Zed: Settings options and API keys', () => {
  for (const klass of ['.q-help', '.q-key-info']) {
    it(`${klass} is a 32px ghost button in ctl, with a 2px transparent border`, () => {
      expect(of(`html.theme-exzed ${klass}`)).toMatchObject({ width: '32px', height: '32px', border: '2px solid transparent', background: 'transparent', color: 'var(--zx-ctl)' })
    })

    it(`${klass} takes the highlight block on hover and while its popover is open, never a colour of its own`, () => {
      for (const state of [':hover', "[aria-expanded='true']"]) {
        expect(of(`html.theme-exzed ${klass}${state}`), state).toMatchObject({ background: 'var(--zx-hl-bg)', color: 'var(--zx-hl-ink)' })
      }
    })
  }

  it('the key field keeps its 320px: IGDB’s two fields need all of it (D63: nothing else wraps)', () => {
    const exzed = declarations(read('styles/theme/exzed.css'))
    expect(exzed.find((d) => d.selector === 'html.theme-exzed .q-key-fields' && d.property === 'width')?.value).toBe('320px')
  })

  it('the explanation is 16px on 24px lines in ink, and its label a kicker: 16px capitals in lab, weight 400 (D63: the Popover card)', () => {
    expect(of('html.theme-exzed .q-help-pop')).toMatchObject({ 'font-size': '16px', 'line-height': '24px', color: 'var(--zx-ink)' })
    expect(of('html.theme-exzed .q-help-pop strong')).toMatchObject({ 'font-size': '16px', 'font-weight': '400', 'line-height': '24px', 'letter-spacing': '0', 'text-transform': 'uppercase', color: 'var(--zx-lab)' })
  })

  it('an API key’s mark is its own 32px block that overlaps nothing, in a 200px name column with 8px after the name (D63)', () => {
    expect(of('html.theme-exzed .q-key-info')).not.toHaveProperty('margin')
    const rules = declarations(read('styles/theme/exzed.css')).filter((d) => d.selector === 'html.theme-exzed .q-key-head')
    expect(Object.fromEntries(rules.map((d) => [d.property, d.value]))).toMatchObject({ width: '200px', gap: '8px' })
  })

  it('a row wider than its column (marked data-wrapped by KeyRow) pins [Test] and the status chip to the row’s right edge, so the chip wraps under [Test], right-aligned with it, and nothing else moves', () => {
    expect(of("html.theme-exzed .q-key-row[data-wrapped] > .q-btn:not(.quiet)")).toMatchObject({ 'margin-left': 'auto' })
    expect(of("html.theme-exzed .q-key-row[data-wrapped] > .q-key-pill")).toMatchObject({ 'margin-left': 'auto' })
  })

  it('a setting with its (?) keeps its own line: the label and the (?) share the 4px above them, and the line under the theme chips (the Spectrum border) takes the board’s 16px itself and gives neither of them any', () => {
    const rules = declarations(read('styles/theme/exzed-checkbox-links.css'))
    const margin = (selector: string) => rules.find((d) => d.property === 'margin-top' && d.selector === selector)?.value
    expect(margin('html.theme-exzed .q-settings-row + .q-settings-line')).toBe('16px')
    expect(margin('html.theme-exzed .q-settings-row + .q-settings-line > .q-settings-check')).toBe('0')
    expect(of('html.theme-exzed .q-settings-line > .q-help')).toMatchObject({ 'margin-top': '4px' })
    expect(of('html.theme-exzed .q-settings-row + .q-settings-line > .q-help')).toMatchObject({ 'margin-top': '0' })
  })
})
