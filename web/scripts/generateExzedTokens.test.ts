import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { customProperties, read } from '../src/styles/theme/cssGuard.js'
import { EXZED_SKINS, EXZED_SKIN_OF_DESIGN_ID } from '../src/lib/preferences/exzedSkins.js'
import { generateExzedTokenCss, EXZED_OUTPUT_PATH, EXZED_TOKENS_JSON_PATH, writeExzedTokens, type ExzedTokens } from './generateExzedTokens.js'

/** Two of design's skins and four of its roles: a per-skin value, an alias, one value for every skin, and a role only some skins list. */
function fixture(): ExzedTokens {
  return {
    color: {
      themes: [
        { id: 'lode', name: '1d Lode' },
        { id: 'lotus', name: '1L Lotus' },
      ],
      tokens: [
        { name: 'paper', value: { lode: '#000000', lotus: '#d7d7d7' } },
        { name: 'acc', value: { lode: '#ffff00', lotus: '#000000' } },
        // An alias inside the per-skin map (design writes `{acc}`), and a literal beside it.
        { name: 't2', value: { lode: '{acc}', lotus: '#0000ff' } },
        // One value for every skin.
        { name: 'ok', value: '#00ff00' },
        // Listed for two skins of the six only (design's `info-line`): the others take the default skin's value.
        { name: 'info-line', value: { lode: '#00ffff', lotus: '#0000d7' } },
      ],
    },
    spacing: { tokens: [{ name: 'row-h', value: '32px' }] },
  }
}

const THREE_SKINS: ExzedTokens = {
  color: {
    themes: [
      { id: 'lode', name: '1d Lode' },
      { id: 'focal', name: '1a Focal' },
      { id: 'lotus', name: '1L Lotus' },
    ],
    tokens: [{ name: 'info-line', value: { lode: '#00ffff', lotus: '#0000d7' } }],
  },
  spacing: { tokens: [] },
}

describe('generateExzedTokenCss', () => {
  it('emits exactly the expected selectors and `--zx-` properties for a two-skin fixture', () => {
    expect(generateExzedTokenCss(fixture())).toBe(
      [
        '/* Generated from design’s eX-Zed tokens.json by generateExzedTokens.ts. Do not edit by hand. */',
        'html.theme-exzed, html[data-theme="exzed-1d"], html [data-theme="exzed-1d"] {',
        '  --zx-paper: #000000;',
        '  --zx-acc: #ffff00;',
        '  --zx-t2: var(--zx-acc);',
        '  --zx-ok: #00ff00;',
        '  --zx-info-line: #00ffff;',
        '}',
        'html[data-theme="exzed-1l"], html [data-theme="exzed-1l"] {',
        '  --zx-paper: #d7d7d7;',
        '  --zx-acc: #000000;',
        '  --zx-t2: #0000ff;',
        '  --zx-ok: #00ff00;',
        '  --zx-info-line: #0000d7;',
        '}',
      ].join('\n'),
    )
  })

  it('names the skins by their keys, never by design’s ids or names', () => {
    const css = generateExzedTokenCss(fixture())

    expect(css).not.toMatch(/lode|lotus|Lode|Lotus/)
  })

  it('only the first skin doubles as the default for an eX-Zed page that has no skin yet', () => {
    const css = generateExzedTokenCss(fixture())

    expect(css).toContain('html.theme-exzed, html[data-theme="exzed-1d"], html [data-theme="exzed-1d"] {')
    expect(css).not.toContain('html.theme-exzed, html[data-theme="exzed-1l"]')
  })

  it('every skin block also matches a nested element carrying its own data-theme (a swatch drawing another skin)', () => {
    const css = generateExzedTokenCss(fixture())

    expect(css).toContain('html [data-theme="exzed-1d"]')
    expect(css).toContain('html [data-theme="exzed-1l"]')
  })

  it('a skin a role does not list takes the default skin’s value', () => {
    const css = generateExzedTokenCss(THREE_SKINS)

    expect(css).toContain('html[data-theme="exzed-1a"], html [data-theme="exzed-1a"] {\n  --zx-info-line: #00ffff;\n}')
  })

  it('refuses a design skin it has no key for, naming it', () => {
    const tokens = fixture()
    tokens.color.themes.push({ id: 'newskin', name: '1n New' })

    expect(() => generateExzedTokenCss(tokens)).toThrow(/newskin/)
  })

  it('refuses a role whose value is not a colour, an alias or absent for the default skin, naming the role', () => {
    const tokens = fixture()
    tokens.color.tokens.push({ name: 'broken', value: { lotus: '#000000' } })

    expect(() => generateExzedTokenCss(tokens)).toThrow(/broken/)
  })
})

describe('the skin keys', () => {
  it('are the six of X-003, in design’s order, and every design id has one', () => {
    expect([...EXZED_SKINS]).toEqual(['exzed-1d', 'exzed-1a', 'exzed-1b', 'exzed-1c', 'exzed-1e', 'exzed-1l'])
    expect(EXZED_SKIN_OF_DESIGN_ID).toEqual({
      lode: 'exzed-1d',
      focal: 'exzed-1a',
      glemt: 'exzed-1b',
      xen: 'exzed-1c',
      kui: 'exzed-1e',
      ikigai: 'exzed-1e',
      lotus: 'exzed-1l',
    })
  })
})

describe('writeExzedTokens', () => {
  let dir: string
  const logged: string[] = []
  const log = (line: string) => logged.push(line)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exzed-tokens-'))
    logged.length = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the CSS from the design tokens when they are there', () => {
    const input = join(dir, 'tokens.json')
    const output = join(dir, 'out', 'exzed-tokens.css')
    writeFileSync(input, JSON.stringify(fixture()))

    expect(writeExzedTokens({ input, output, log })).toBe('generated')
    expect(readFileSync(output, 'utf8')).toBe(`${generateExzedTokenCss(fixture())}\n`)
  })

  it('keeps the committed CSS when the design tokens are not there (a clone, CI)', () => {
    const output = join(dir, 'exzed-tokens.css')
    writeFileSync(output, 'committed')

    expect(writeExzedTokens({ input: join(dir, 'absent.json'), output, log })).toBe('kept')
    expect(readFileSync(output, 'utf8')).toBe('committed')
    expect(logged.join(' ')).toMatch(/kept/i)
  })

  it('fails, naming both files, when neither is there', () => {
    const input = join(dir, 'absent.json')
    const output = join(dir, 'exzed-tokens.css')

    expect(() => writeExzedTokens({ input, output, log })).toThrow(new RegExp(`${input}[\\s\\S]*${output}|${output}[\\s\\S]*${input}`))
    expect(existsSync(output)).toBe(false)
  })
})

describe('the committed exzed-tokens.css', () => {
  it.skipIf(!existsSync(EXZED_TOKENS_JSON_PATH))('is what the design tokens generate (it cannot go stale)', () => {
    const tokens = JSON.parse(readFileSync(EXZED_TOKENS_JSON_PATH, 'utf8')) as ExzedTokens

    expect(readFileSync(EXZED_OUTPUT_PATH, 'utf8')).toBe(`${generateExzedTokenCss(tokens)}\n`)
  })

  /** The sixteen colours of the Spectrum (black counted once): normal `#d7…` and bright `#ff…`. Design: "only Spectrum colours". */
  const SPECTRUM = new Set([
    '#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
    '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff',
  ])
  const roles = customProperties(read('styles/theme/exzed-tokens.css'))

  it('has the thirty-one roles, each with one value in each of the six skins', () => {
    expect(roles.size).toBe(31)
    for (const [role, values] of roles) expect(values, role).toHaveLength(6)
  })

  it('draws every role from the Spectrum colours or from another role: no hex outside it, no alpha', () => {
    const outside: string[] = []
    for (const [role, values] of roles) {
      for (const value of values) if (!SPECTRUM.has(value) && !/^var\(--zx-[\w-]+\)$/.test(value)) outside.push(`${role}: ${value}`)
    }

    expect(outside).toEqual([])
  })

  it('resolves design’s aliases: the title gradient’s middle band is the accent, except on Lotus, where it is bright blue', () => {
    expect(roles.get('--zx-t2')).toEqual(['var(--zx-acc)', 'var(--zx-acc)', 'var(--zx-acc)', 'var(--zx-acc)', 'var(--zx-acc)', '#0000ff'])
    expect(roles.get('--zx-t3')).toEqual(['var(--zx-acc-dim)', 'var(--zx-acc-dim)', 'var(--zx-acc-dim)', 'var(--zx-acc-dim)', 'var(--zx-acc-dim)', '#0000d7'])
  })

  it('gives the skins design does not list for `info-line` the dark skins’ bright cyan, and Lotus its normal blue', () => {
    expect(roles.get('--zx-info-line')).toEqual(['#00ffff', '#00ffff', '#00ffff', '#00ffff', '#00ffff', '#0000d7'])
  })

  it('has the paper and the page ground black in the five dark skins and normal white on Lotus', () => {
    expect(roles.get('--zx-paper')).toEqual(['#000000', '#000000', '#000000', '#000000', '#000000', '#d7d7d7'])
    expect(roles.get('--zx-stage')).toEqual(['#000000', '#000000', '#000000', '#000000', '#000000', '#d7d7d7'])
  })
})

/**
 * Design’s spacing tokens against what Phase 48 hand-wrote in `exzed.css` (it is not generated: a theme’s sizes are rules, not skin colours).
 * Each design token is either one of ours by name, and then the value is equal, or on the list of those nothing reads yet.
 */
describe('design’s spacing tokens', () => {
  const DESIGN_TOKEN_TO_OURS: Record<string, string> = {
    'row-h': '--row-h',
    'control-h': '--control-h',
    'window-min': '--layer-min',
    'window-max': '--layer-max',
    'stage-gap': '--stage-gap',
    'app-max': '--app-max',
  }
  /** Not a token of ours yet: X-004 and X-007 draw with 2px, 4px and the 8px steps as literals component by component. */
  const NOT_HOOKED = ['px', 'space-1', 'space-2', 'space-3', 'space-5', 'frame-w', 'line-w']
  const ours = customProperties(read('styles/theme/exzed.css'))

  it.skipIf(!existsSync(EXZED_TOKENS_JSON_PATH))('every design spacing token is one we hook, with the same value, or is on the list nothing reads yet', () => {
    const design = (JSON.parse(readFileSync(EXZED_TOKENS_JSON_PATH, 'utf8')) as { spacing: { tokens: { name: string; value: string }[] } }).spacing.tokens
    const unknown = design.map((t) => t.name).filter((name) => !(name in DESIGN_TOKEN_TO_OURS) && !NOT_HOOKED.includes(name))

    expect(unknown, 'a new design spacing token needs a decision').toEqual([])
    for (const { name, value } of design) {
      const token = DESIGN_TOKEN_TO_OURS[name]
      if (token) expect(ours.get(token), `${name} is ${token}`).toEqual([value])
    }
  })

  it('every token of ours that stands for a design one is defined by exzed.css', () => {
    for (const token of Object.values(DESIGN_TOKEN_TO_OURS)) expect(ours.has(token), token).toBe(true)
  })
})
