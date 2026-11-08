import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRunDirectly } from '../../server/src/tools/runDirectly.js'
import { EXZED_SKIN_OF_DESIGN_ID } from '../src/lib/preferences/exzedSkins.js'

/**
 * Generates the eX-Zed colour roles from design's `tokens.json` (task 49.1, X-003), the way `generateTokens.ts` does Quantum's: the output is never
 * hand-edited, is committed (a clone or CI builds from it), and is regenerated where the design tokens exist. A test checks the committed file is
 * what they generate.
 *
 * Roles are written `--zx-<role>` so they cannot collide with Quantum's `--ink`, `--accent` and the rest: the components keep reading Quantum's
 * names and `exzed.css` gives each one a role (design's answer 3 to X-002; `docs/design/exzed-colour-mapping.md`). One block per skin, keyed by the
 * skin's number (`exzed-1d`), never by design's id or name; each block also matches a nested element that carries its own `data-theme`, so a swatch
 * can draw another skin than the active one. The first skin doubles as the default of an eX-Zed page that has no skin yet.
 */
interface ColorRole {
  name: string
  /** One value for every skin, or a per-skin map (a value may be an alias such as `{acc}`). */
  value: string | Record<string, string>
}

export interface ExzedTokens {
  color: {
    themes: { id: string; name: string }[]
    tokens: ColorRole[]
  }
  spacing: { tokens: { name: string; value: string }[] }
}

const ALIAS_PATTERN = /^\{([\w-]+)\}$/
const PREFIX = '--zx-'
const SCOPE = 'html'

/** A role's value for one skin: its own entry, else the default skin's (design's `info-line` lists the first skin and Lotus only). */
function valueFor(role: ColorRole, themeId: string, defaultId: string): string {
  if (typeof role.value === 'string') return role.value
  const own = role.value[themeId] ?? role.value[defaultId]
  if (own === undefined) throw new Error(`The colour role "${role.name}" has no value for the default skin "${defaultId}", so a skin it does not list has nothing to take.`)
  return own
}

function skinBlock(themeId: string, defaultId: string, key: string, isDefault: boolean, roles: ColorRole[]): string {
  const nested = `${SCOPE} [data-theme="${key}"]`
  const selector = isDefault ? `${SCOPE}.theme-exzed, ${SCOPE}[data-theme="${key}"], ${nested}` : `${SCOPE}[data-theme="${key}"], ${nested}`
  const lines = roles.map((role) => {
    const value = valueFor(role, themeId, defaultId)
    const alias = ALIAS_PATTERN.exec(value)
    return `  ${PREFIX}${role.name}: ${alias ? `var(${PREFIX}${alias[1]})` : value};`
  })
  return `${selector} {\n${lines.join('\n')}\n}`
}

/** Pure, no file I/O: the function the test exercises directly. */
export function generateExzedTokenCss(tokens: ExzedTokens): string {
  const keyOf = (id: string): string => {
    const key = (EXZED_SKIN_OF_DESIGN_ID as Record<string, string | undefined>)[id]
    if (!key) throw new Error(`Design has a skin "${id}" that has no key: add it to EXZED_SKIN_OF_DESIGN_ID (lib/preferences/exzedSkins.ts).`)
    return key
  }
  const defaultId = tokens.color.themes[0]?.id
  if (!defaultId) throw new Error('The design tokens list no skins.')

  const blocks = tokens.color.themes.map((theme, index) => skinBlock(theme.id, defaultId, keyOf(theme.id), index === 0, tokens.color.tokens))
  return [`/* Generated from design’s eX-Zed tokens.json by generateExzedTokens.ts. Do not edit by hand. */`, ...blocks].join('\n')
}

/** The design handoff's tokens: in `docs/`, which is local (gitignored), so absent from a clone and from CI. */
export const EXZED_TOKENS_JSON_PATH = fileURLToPath(new URL('../../docs/design/claude-design/exzed/tokens.json', import.meta.url))
/** Committed: a clone or CI builds from it; where the handoff exists, it is regenerated each build. */
export const EXZED_OUTPUT_PATH = fileURLToPath(new URL('../src/styles/theme/exzed-tokens.css', import.meta.url))

/**
 * Writes `exzed-tokens.css` from the design tokens when they are there; keeps the committed file when they are not; fails, naming both files, when
 * neither is there.
 */
export function writeExzedTokens({
  input = EXZED_TOKENS_JSON_PATH,
  output = EXZED_OUTPUT_PATH,
  log = console.log,
}: { input?: string; output?: string; log?: (line: string) => void } = {}): 'generated' | 'kept' {
  if (!existsSync(input)) {
    if (existsSync(output)) {
      log(`Kept ${output} (no eX-Zed design tokens at ${input})`)
      return 'kept'
    }
    throw new Error(`No eX-Zed design tokens at ${input}, and no committed ${output} to build from.`)
  }

  const tokens = JSON.parse(readFileSync(input, 'utf8')) as ExzedTokens
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${generateExzedTokenCss(tokens)}\n`)
  log(`Wrote ${output}`)
  return 'generated'
}

if (isRunDirectly(import.meta.url)) {
  writeExzedTokens()
}
