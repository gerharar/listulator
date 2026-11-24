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

  it('an API key’s mark takes the 20px of room it had (a 32px block with -4px and -8px of margin), because the name column stays 168px and the field 320px: Russian at the narrowest window fills the column to the pixel', () => {
    expect(of('html.theme-exzed .q-key-info')).toMatchObject({ margin: '0 -8px 0 -4px' })
    const exzed = declarations(read('styles/theme/exzed.css'))
    expect(exzed.find((d) => d.selector === 'html.theme-exzed .q-key-head' && d.property === 'width')?.value).toBe('168px')
    expect(exzed.find((d) => d.selector === 'html.theme-exzed .q-key-fields' && d.property === 'width')?.value).toBe('320px')
  })

  it('the popover of a setting is 16px on 24px lines, in ink; the label is not bold (the theme has one weight)', () => {
    expect(of('html.theme-exzed .q-help-pop')).toMatchObject({ 'font-size': '16px', 'line-height': '24px', color: 'var(--zx-ink)' })
    expect(of('html.theme-exzed .q-help-pop strong')).toMatchObject({ 'font-size': '16px', 'font-weight': '400' })
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
