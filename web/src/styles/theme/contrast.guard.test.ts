import { describe, expect, it } from 'vitest'
import { contrastRatio, declarations, read } from './cssGuard.js'

/**
 * Contrast of eX-Zed's six skins (Phase 49.6, design's X-013). A pure-data test over the generated `exzed-tokens.css`: for each skin, the pairs the
 * components draw. Text on its ground needs 4.5:1 (WCAG AA); a border or a rule on `paper` or `stage` needs 3:1 (non-text, AA). The ratio is the WCAG
 * relative-luminance formula, tested on pairs whose answer is known.
 *
 * A pair that fails is design's to answer, not ours to change: the skins' colours are design's file, generated. It is named in `ALLOWED` with the ratio
 * measured and where it was reported. The list fails the other way too: a pair that starts passing, or whose ratio changes, is a new decision and
 * has to be read and re-recorded, so the allow-list can never hide a colour that moved.
 */
const TEXT = 4.5
const BORDER = 3

/** [foreground role, background role]: what the components draw (the roles are the names of `exzed-tokens.css`). */
const TEXT_PAIRS = [
  ['ink', 'paper'],
  ['ink2', 'paper'],
  ['lab', 'paper'],
  ['hdr-ink', 'hdr'],
  ['hdr-ink2', 'hdr'],
  ['acc-ink', 'acc'],
  ['acc-ink', 'acc-dim'],
  ['pri-hv-ink', 'pri-hv'],
  ['skin-ink', 'skin'],
  ['chip-ink', 'info'],
  ['chip-ink', 'ok'],
  ['chip-ink', 'warn'],
  ['chip-ink', 'danger'],
] as const

const BORDER_PAIRS = [
  ['frame', 'paper'],
  ['frame', 'stage'],
  ['frame-hi', 'paper'],
  ['frame-hi', 'stage'],
  ['info-line', 'paper'],
  ['info-line', 'stage'],
] as const

interface Allowed {
  skin: string
  foreground: string
  background: string
  /** The ratio as measured, to two places. */
  ratio: number
  why: string
}

const ALLOWED: readonly Allowed[] = [
  {
    skin: 'exzed-1d',
    foreground: 'skin-ink',
    background: 'skin',
    ratio: 4,
    why: 'White on pure red, the text on the skin block (the skin button and swatch label) of Lode: 4.00:1, under the 4.5:1 of normal text. Reported to design in docs/design/HANDOFF-STATUS.md, “X-013 · contrast of the six skins” (2026-11-09); revisit when design answers.',
  },
]

const css = declarations(read('styles/theme/exzed-tokens.css'))

/** Every skin key in the generated file, in file order. */
const SKINS = [...new Set(css.map((d) => /html\[data-theme="(exzed-\w+)"\]/.exec(d.selector)?.[1]).filter((key): key is string => key !== undefined))]

/** A skin's own role values as written, by the block whose selector names it (the nested `html [data-theme=…]` twin has the same body). */
const written = (skin: string): Map<string, string> =>
  new Map(css.filter((d) => d.selector.includes(`html[data-theme="${skin}"]`) && d.property.startsWith('--zx-')).map((d) => [d.property.slice(5), d.value]))

/** A role's colour in a skin: its own value, else the default skin's (the generator’s rule), with an alias (`var(--zx-acc)`) followed. */
function colour(skin: string, role: string): string {
  const value = written(skin).get(role) ?? written(SKINS[0]!).get(role)
  if (value === undefined) throw new Error(`${skin} has no role ${role}`)
  const alias = /^var\(--zx-([\w-]+)\)$/.exec(value)?.[1]
  return alias ? colour(skin, alias) : value
}

const measured = (skin: string, foreground: string, background: string) => contrastRatio(colour(skin, foreground), colour(skin, background))

describe('the WCAG contrast ratio', () => {
  it('is 21:1 for black on white, in either order, and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10)
    expect(contrastRatio('#d7d700', '#d7d700')).toBe(1)
  })

  it('is 7.4:1 for Lotus’s blue on its paper, as design states', () => {
    expect(contrastRatio('#0000d7', '#d7d7d7').toFixed(1)).toBe('7.4')
  })

  it('is 4.00 for white on pure red and 5.25 for black on it (the pair this file allows, and its neighbour)', () => {
    expect(contrastRatio('#ffffff', '#ff0000').toFixed(2)).toBe('4.00')
    expect(contrastRatio('#000000', '#ff0000').toFixed(2)).toBe('5.25')
  })

  it('reads #rgb and #rrggbb alike', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 10)
  })
})

describe('the skins’ colours', () => {
  it('are read: six skins, each with every role a solid #rrggbb', () => {
    expect(SKINS).toEqual(['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'])
    for (const skin of SKINS) for (const role of written(SKINS[0]!).keys()) expect(colour(skin, role), `${skin} ${role}`).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('contrast per skin', () => {
  const allowed = (skin: string, foreground: string, background: string) => ALLOWED.find((a) => a.skin === skin && a.foreground === foreground && a.background === background)

  describe.each(SKINS)('%s', (skin) => {
    it.each(TEXT_PAIRS)(`text: %s on %s is at least ${TEXT}:1, or is allow-listed`, (foreground, background) => {
      expect(measured(skin, foreground, background) >= TEXT || allowed(skin, foreground, background) !== undefined, `${foreground} on ${background}: ${measured(skin, foreground, background).toFixed(2)}`).toBe(true)
    })

    it.each(BORDER_PAIRS)(`border: %s on %s is at least ${BORDER}:1, or is allow-listed`, (foreground, background) => {
      expect(measured(skin, foreground, background) >= BORDER || allowed(skin, foreground, background) !== undefined, `${foreground} on ${background}: ${measured(skin, foreground, background).toFixed(2)}`).toBe(true)
    })
  })

  describe('the allow-list', () => {
    it.each(ALLOWED)('$skin $foreground on $background is a pair this guard checks, still under its minimum, at the recorded ratio', (entry) => {
      const isText = TEXT_PAIRS.some(([f, b]) => f === entry.foreground && b === entry.background)
      const isBorder = BORDER_PAIRS.some(([f, b]) => f === entry.foreground && b === entry.background)
      const ratio = measured(entry.skin, entry.foreground, entry.background)

      expect(isText || isBorder, 'a pair in TEXT_PAIRS or BORDER_PAIRS').toBe(true)
      expect(ratio, 'it passes now: remove it from ALLOWED').toBeLessThan(isText ? TEXT : BORDER)
      expect(Number(ratio.toFixed(2)), 'its ratio changed: re-read it and update ALLOWED and the report').toBe(entry.ratio)
    })
  })

  it('Lotus’s blue on its paper is design’s 7.4:1', () => {
    expect(measured('exzed-1l', 'lab', 'paper').toFixed(1)).toBe('7.4')
  })
})
