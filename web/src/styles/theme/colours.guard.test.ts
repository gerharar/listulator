import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declarations, read } from './cssGuard.js'

/**
 * eX-Zed's colours (Phase 49.3, X-003). Components keep reading Quantum's colour names (`--card`, `--ink`, `--accent`...); under `html.theme-exzed`
 * `exzed-colours.css` gives each one a solid role of the active skin (`--zx-paper`, ...), so every screen draws in the Spectrum colours with no
 * component edited. The table below is the accepted mapping of task 49.0 (`docs/design/exzed-colour-mapping.md`, design's answers of 2026-11-08):
 *  1. every Quantum colour token is mapped, none twice, none left out when design's file gains one;
 *  2. each maps to exactly the role the table names, and that role exists in every skin;
 *  3. nothing in the file is an rgba or a literal: a mapping is `var(--zx-<role>)`, so a skin cannot draw a translucent colour;
 *  4. `color-scheme` is dark for the five dark skins and light for Lotus (`exzed-1l`), which `base.css` cannot know (it keys on `dark*` / `light*`).
 */
const MAPPING = {
  bg: 'stage',
  card: 'paper',
  ink: 'ink',
  ink2: 'ink2',
  ink3: 'ink2',
  line: 'frame',
  rule: 'frame',
  fill: 'paper',
  field: 'paper',
  hover: 'paper',
  done: 'paper',
  barEmpty: 'prog-dim',
  accent: 'acc',
  accentInk: 'acc-ink',
  pulseTint: 'paper',
  info: 'info',
  statusGold: 'ok',
  star: 'star',
  goldDeep: 'ok',
  gold: 'ok',
  goldLite: 'ok',
  danger: 'danger',
  warn: 'warn',
  ok: 'ok',
  sec: 'skin',
  deep: 'prog-dim',
  cyan: 'info',
  washA: 'stage',
  washB: 'stage',
  washC: 'stage',
  scrim: 'stage',
  headSub: 'ink',
} as const

const colours = read('styles/theme/exzed-colours.css')
const mapped = declarations(colours).filter((d) => d.selector === 'html.theme-exzed' && d.property.startsWith('--'))
const roles = new Set(declarations(read('styles/theme/exzed-tokens.css')).filter((d) => d.property.startsWith('--zx-')).map((d) => d.property.slice(5)))

/** Quantum's colour tokens: what the generated file gives a colour literal, or an alias of another colour token (`--headSub: var(--ink)`). */
function quantumColourTokens(): string[] {
  const first = declarations(read('styles/quantum/tokens.css')).filter((d) => d.selector.startsWith('html, html[data-theme='))
  const literal = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i
  const found = new Set(first.filter((d) => literal.test(d.value)).map((d) => d.property))
  for (const d of first) {
    const alias = /^var\((--[\w-]+)\)$/.exec(d.value)?.[1]
    if (alias && found.has(alias)) found.add(d.property)
  }
  return [...found].map((property) => property.slice(2))
}

describe('eX-Zed’s colour mapping', () => {
  it('is read: 32 Quantum colour tokens, 30 roles', () => {
    expect(Object.keys(MAPPING)).toHaveLength(32)
    expect(roles.size).toBe(30)
    expect(mapped.length).toBeGreaterThan(0)
  })

  it('covers every colour token of Quantum’s generated file, and only those', () => {
    expect(Object.keys(MAPPING).sort()).toEqual(quantumColourTokens().sort())
  })

  it.each(Object.entries(MAPPING))('maps --%s to --zx-%s', (token, role) => {
    const values = mapped.filter((d) => d.property === `--${token}`).map((d) => d.value)

    expect(values).toEqual([`var(--zx-${role})`])
  })

  it('maps nothing but the 32 tokens, so no stray override hides in the file', () => {
    expect(mapped.map((d) => d.property.slice(2)).sort()).toEqual(Object.keys(MAPPING).sort())
  })

  it('maps every token to a role every skin has', () => {
    for (const role of Object.values(MAPPING)) expect(roles.has(role), role).toBe(true)
  })

  it('holds no colour of its own: no hex, no rgb, no hsl, no color-mix, no alpha', () => {
    expect(colours).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(|\balpha\b/i)
    for (const d of mapped) expect(d.value, d.property).toMatch(/^var\(--zx-[a-z0-9-]+\)$/)
  })
})

describe('eX-Zed’s colour scheme', () => {
  const scheme = (selector: string) => declarations(colours).filter((d) => d.selector === selector && d.property === 'color-scheme').map((d) => d.value)

  it('is dark for the theme, so Lode and the four other dark skins and a hand-set theme with no skin yet are dark', () => {
    expect(scheme('html.theme-exzed')).toEqual(['dark'])
  })

  it('is light for Lotus alone', () => {
    expect(scheme("html.theme-exzed[data-theme='exzed-1l']")).toEqual(['light'])
    expect(declarations(colours).filter((d) => d.property === 'color-scheme')).toHaveLength(2)
  })
})

describe('the mapping table of docs/design/exzed-colour-mapping.md', () => {
  // docs/ is a private repo that a public clone does not have: the check runs wherever it is.
  const file = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'design', 'exzed-colour-mapping.md')

  it.runIf(existsSync(file))('says the same as the table above', () => {
    const text = readFileSync(file, 'utf8')
    const section = text.slice(text.indexOf('## A.'), text.indexOf('## B.'))
    const rows = [...section.matchAll(/^\| `(\w+)` \| `([\w-]+)` \|/gm)].map((row) => [row[1], row[2]])

    expect(Object.fromEntries(rows)).toEqual(MAPPING)
  })
})
