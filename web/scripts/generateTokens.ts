import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Generates the Quantum token CSS from `design-system/tokens.json` (task
 * 10.3, D9). The output is never hand-edited and never committed — it's
 * regenerated at dev/build time (see the `predev`/`prebuild` scripts in
 * `package.json`), so `tokens.json` is the only place a value can drift
 * from.
 *
 * The scope selector is a parameter (D9): `.q-root` during the transition,
 * `html` at cutover (task 10.32). Passing a new scope needs no other
 * change here — every skin block in `tokens.json` becomes a `[data-theme]`
 * block under it, so a future Wireframe or Modernist block needs no
 * generator change either.
 */

interface ColorToken {
  name: string
  /** A per-skin map, or an alias string like `"{ink}"` referencing another color token. */
  value: Record<string, string> | string
}

interface TypeStyle {
  name: string
  fontSize: string
  lineHeight: number
  fontWeight: number
  letterSpacing?: string
}

interface TypeGroup {
  family: 'sans' | 'mono'
  styles: TypeStyle[]
}

interface ValueToken {
  name: string
  value: string
}

export interface QuantumTokens {
  color: {
    themes: { id: string; name: string }[]
    tokens: ColorToken[]
  }
  type: {
    families: { sans: string; mono: string }
    groups: TypeGroup[]
  }
  spacing: { tokens: ValueToken[] }
  shadow: { tokens: ValueToken[] }
  size: { tokens: ValueToken[] }
  zIndex: { tokens: ValueToken[] }
  duration: { tokens: ValueToken[] }
  opacity: { tokens: ValueToken[] }
}

const ALIAS_PATTERN = /^\{(\w+)\}$/

function colorBlock(scope: string, themeId: string, isDefault: boolean, tokens: ColorToken[]): string {
  const selector = isDefault ? `${scope}, ${scope}[data-theme="${themeId}"]` : `${scope}[data-theme="${themeId}"]`

  const lines = tokens
    .map((token) => {
      if (typeof token.value === 'string') {
        const alias = ALIAS_PATTERN.exec(token.value)
        return alias ? `  --${token.name}: var(--${alias[1]});` : null
      }
      const value = token.value[themeId]
      return value !== undefined ? `  --${token.name}: ${value};` : null
    })
    .filter((line): line is string => line !== null)

  return `${selector} {\n${lines.join('\n')}\n}`
}

function sharedBlock(scope: string, tokens: QuantumTokens): string {
  const valueTokens = [
    ...tokens.spacing.tokens,
    ...tokens.shadow.tokens,
    ...tokens.size.tokens,
    ...tokens.zIndex.tokens,
    ...tokens.duration.tokens,
    ...tokens.opacity.tokens,
  ]

  const lines = [
    ...valueTokens.map((token) => `  --${token.name}: ${token.value};`),
    `  --font-sans: ${tokens.type.families.sans};`,
    `  --font-mono: ${tokens.type.families.mono};`,
  ]

  return `${scope} {\n${lines.join('\n')}\n}`
}

function typeStyleRules(tokens: QuantumTokens): string[] {
  return tokens.type.groups.flatMap((group) =>
    group.styles.map((style) => {
      const letterSpacing = style.letterSpacing ? ` letter-spacing: ${style.letterSpacing};` : ''
      return (
        `.${style.name} { font-family: var(--font-${group.family}); font-size: ${style.fontSize}; ` +
        `line-height: ${style.lineHeight}; font-weight: ${style.fontWeight};${letterSpacing} }`
      )
    }),
  )
}

/** Pure — no file I/O, so it's the same function the test file exercises directly. */
export function generateTokenCss(tokens: QuantumTokens, scope: string): string {
  const colorBlocks = tokens.color.themes.map((theme, index) =>
    colorBlock(scope, theme.id, index === 0, tokens.color.tokens),
  )

  return [
    `/* Generated from design-system/tokens.json by generateTokens.ts. Do not edit by hand. */`,
    ...colorBlocks,
    sharedBlock(scope, tokens),
    ...typeStyleRules(tokens),
  ].join('\n')
}

const TOKENS_JSON_PATH = fileURLToPath(
  new URL(
    '../../docs/design/claude-design/design_handoff_listulator_quantum_v2/design-system/tokens.json',
    import.meta.url,
  ),
)
const OUTPUT_DIR = fileURLToPath(new URL('../src/styles/quantum', import.meta.url))
const OUTPUT_PATH = `${OUTPUT_DIR}/tokens.css`
const SCOPE = '.q-root'

function main(): void {
  const tokens = JSON.parse(readFileSync(TOKENS_JSON_PATH, 'utf8')) as QuantumTokens
  const css = generateTokenCss(tokens, SCOPE)

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(OUTPUT_PATH, `${css}\n`)
  console.log(`Wrote ${OUTPUT_PATH}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
