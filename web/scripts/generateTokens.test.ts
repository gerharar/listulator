import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateTokenCss, OUTPUT_PATH, SCOPE, TOKENS_JSON_PATH, writeTokens, type QuantumTokens } from './generateTokens.js'

function fixture(): QuantumTokens {
  return {
    color: {
      themes: [
        { id: 'dark-orange', name: 'Dark orange' },
        { id: 'light-bone', name: 'Light bone' },
      ],
      tokens: [
        { name: 'bg', value: { 'dark-orange': '#181513', 'light-bone': '#f5f0e6' } },
        { name: 'ink', value: { 'dark-orange': '#ede6de', 'light-bone': '#221f19' } },
        // An alias — same var() reference regardless of skin, not a per-skin value.
        { name: 'headSub', value: '{ink}' },
      ],
    },
    type: {
      families: {
        sans: 'Inter, system-ui, sans-serif',
        mono: '"JetBrains Mono", ui-monospace, monospace',
      },
      groups: [
        {
          family: 'sans',
          styles: [
            {
              name: 't-screen-title',
              fontSize: '24px',
              lineHeight: 1.02,
              fontWeight: 700,
              letterSpacing: '-0.022em',
            },
          ],
        },
        {
          family: 'mono',
          styles: [{ name: 't-num', fontSize: '13px', lineHeight: 1, fontWeight: 500 }],
        },
      ],
    },
    spacing: { tokens: [{ name: 's-1', value: '2px' }] },
    shadow: { tokens: [{ name: 'e-pop', value: '0 12px 30px rgba(0,0,0,.18)' }] },
    size: { tokens: [{ name: 'cell-cap', value: '20' }] },
    zIndex: { tokens: [{ name: 'z-pop', value: '120' }] },
    duration: { tokens: [{ name: 'd-push', value: '210ms' }] },
    opacity: { tokens: [{ name: 'o-disabled', value: '0.45' }] },
  }
}

describe('generateTokenCss', () => {
  it('emits exactly the expected selectors and custom properties for a two-skin fixture', () => {
    const css = generateTokenCss(fixture(), '.q-root')

    expect(css).toBe(
      [
        '/* Generated from design-system/tokens.json by generateTokens.ts. Do not edit by hand. */',
        '.q-root, .q-root[data-theme="dark-orange"], .q-root [data-theme="dark-orange"] {',
        '  --bg: #181513;',
        '  --ink: #ede6de;',
        '  --headSub: var(--ink);',
        '}',
        '.q-root[data-theme="light-bone"], .q-root [data-theme="light-bone"] {',
        '  --bg: #f5f0e6;',
        '  --ink: #221f19;',
        '  --headSub: var(--ink);',
        '}',
        '.q-root {',
        '  --s-1: 2px;',
        '  --e-pop: 0 12px 30px rgba(0,0,0,.18);',
        '  --cell-cap: 20;',
        '  --z-pop: 120;',
        '  --d-push: 210ms;',
        '  --o-disabled: 0.45;',
        '  --font-sans: Inter, system-ui, sans-serif;',
        '  --font-mono: "JetBrains Mono", ui-monospace, monospace;',
        '}',
        '.t-screen-title { font-family: var(--font-sans); font-size: 24px; line-height: 1.02; font-weight: 700; letter-spacing: -0.022em; }',
        '.t-num { font-family: var(--font-mono); font-size: 13px; line-height: 1; font-weight: 500; }',
      ].join('\n'),
    )
  })

  it('only the first skin doubles as the bare-scope default', () => {
    const css = generateTokenCss(fixture(), '.q-root')

    expect(css).toContain(
      '.q-root, .q-root[data-theme="dark-orange"], .q-root [data-theme="dark-orange"] {',
    )
    expect(css).not.toContain('.q-root, .q-root[data-theme="light-bone"]')
  })

  it('uses whatever scope selector it is given, with no other change', () => {
    const css = generateTokenCss(fixture(), 'html')

    expect(css).toContain('html, html[data-theme="dark-orange"], html [data-theme="dark-orange"] {')
    expect(css).toContain('html[data-theme="light-bone"], html [data-theme="light-bone"] {')
    expect(css).toContain('html {\n  --s-1: 2px;')
  })

  it('every skin block also matches a nested element carrying its own data-theme — a swatch drawing a skin other than the active one (SkinSwatch)', () => {
    const css = generateTokenCss(fixture(), '.q-root')

    expect(css).toContain('.q-root [data-theme="dark-orange"]')
    expect(css).toContain('.q-root [data-theme="light-bone"]')
  })

  it('a token with a letter-spacing-less style omits the property entirely', () => {
    const css = generateTokenCss(fixture(), '.q-root')

    expect(css).toContain(
      '.t-num { font-family: var(--font-mono); font-size: 13px; line-height: 1; font-weight: 500; }',
    )
    expect(css).not.toMatch(/t-num[^}]*letter-spacing/)
  })

  it('is generated under `html`, so the tokens reach portals and everything else in the document (10.32)', () => {
    expect(SCOPE).toBe('html')

    const css = generateTokenCss(fixture(), SCOPE)

    expect(css).toContain('html, html[data-theme="dark-orange"], html [data-theme="dark-orange"] {')
    expect(css).not.toContain('.q-root')
  })
})

/**
 * Phase 17: the design handoff (`docs/`, gitignored) is not in the public repo, so a fresh clone or CI cannot
 * generate `tokens.css`. The generated file is committed; the generator refreshes it where the handoff exists and
 * keeps it where it does not.
 */
describe('writeTokens', () => {
  let dir: string
  const logged: string[] = []
  const log = (line: string) => logged.push(line)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tokens-'))
    logged.length = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes the CSS from the design tokens when they are there', () => {
    const input = join(dir, 'tokens.json')
    const output = join(dir, 'out', 'tokens.css')
    writeFileSync(input, JSON.stringify(fixture()))

    expect(writeTokens({ input, output, log })).toBe('generated')
    expect(readFileSync(output, 'utf8')).toBe(`${generateTokenCss(fixture(), SCOPE)}\n`)
  })

  it('keeps the committed CSS when the design tokens are not there (a clone, CI)', () => {
    const output = join(dir, 'tokens.css')
    writeFileSync(output, 'committed')

    expect(writeTokens({ input: join(dir, 'absent.json'), output, log })).toBe('kept')
    expect(readFileSync(output, 'utf8')).toBe('committed')
    expect(logged.join(' ')).toMatch(/kept/i)
  })

  it('fails, naming both files, when neither is there', () => {
    const input = join(dir, 'absent.json')
    const output = join(dir, 'tokens.css')

    let message = ''
    try {
      writeTokens({ input, output, log })
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain(input)
    expect(message).toContain(output)
    expect(existsSync(output)).toBe(false)
  })
})

describe('the committed tokens.css', () => {
  it.skipIf(!existsSync(TOKENS_JSON_PATH))('is what the design tokens generate (it cannot go stale)', () => {
    const tokens = JSON.parse(readFileSync(TOKENS_JSON_PATH, 'utf8')) as QuantumTokens

    expect(readFileSync(OUTPUT_PATH, 'utf8')).toBe(`${generateTokenCss(tokens, SCOPE)}\n`)
  })
})
