import { readFileSync, writeFileSync } from 'node:fs'
import { createMediaTypeRegistry } from '../server/src/ingestion/mediaTypes.js'
import { parseCustomList } from '../server/src/ingestion/customLists.js'
import { PLATFORMS, PLATFORM_ORDER, platformKey, platformCode } from '../server/src/catalog/platforms.js'
import { isRunDirectly } from '../server/src/tools/runDirectly.js'

/**
 * A pre-commit convenience for anyone drafting a `game` list (by hand, or
 * with an LLM) who used a platform's full name or a common nickname instead
 * of the code `config/platforms.csv` requires. Resolves what it can and lists
 * the rest for a human to decide — it never guesses. Changes nothing unless
 * you pass `--write`, and even then it only ever touches a `tags:` block in a
 * list whose `category` has a platform facet (`game` today).
 *
 * This is NOT the gate: `validateLists.ts` (the pre-commit hook) is, and
 * stays exactly as strict as CONTRIBUTING.md describes. This script just
 * closes some of the gap before you reach it, in a second lookup layer
 * (`EXTRA_ALIASES` below) on top of `platforms.ts`'s own
 * `LEGACY_PLATFORM_TAGS` — that table is scoped to tags already written into
 * real lists before 10.24c, not a place to dump every phrasing a chatbot
 * might produce, so this script keeps its own list instead of extending it.
 *
 * Usage:
 *   npx tsx lists/normalize-platform-tags.ts lists/game/*.yaml
 *   npx tsx lists/normalize-platform-tags.ts --write lists/game/my-new-list.yaml
 */

/**
 * A platform's full `config/platforms.csv` name, lower-cased, to its code —
 * built from `PLATFORMS` (the table `platforms.ts` already exports), not a
 * second copy of it. Covers "PlayStation 5" -> PS5, "Xbox One" -> XONE, and
 * every other name that is already an exact (if long) match.
 */
const NAME_TO_CODE = new Map<string, string>(
  Object.entries(PLATFORMS).map(([code, name]) => [name.toLowerCase(), platformCode(code)]),
)

/**
 * Common phrasings that are neither a code, a `LEGACY_PLATFORM_TAGS` entry,
 * nor an exact `config/platforms.csv` name — gathered from what an LLM tends
 * to write when asked for a game's platforms. Deliberately short: a gap
 * found later is another line here, not a reason to guess in the resolver
 * below. Lower-cased keys; values are real codes from the table.
 */
const EXTRA_ALIASES: Readonly<Record<string, string>> = {
  mac: 'MAC',
  macos: 'MAC',
  'os x': 'MAC',
  gamecube: 'GCN',
  ngc: 'GCN',
  'super nintendo': 'SNES',
  'super famicom': 'SNES',
  genesis: 'GEN',
  'mega drive': 'GEN',
  'sega genesis': 'GEN',
  'ps vita': 'VITA',
  'playstation 1': 'PS1',
  psx: 'PS1',
  'xbox series x/s': 'XSX',
  'xbox series x|s': 'XSX',
  'xbox series x': 'XSX',
  'xbox series s': 'XSX',
  'steam os': 'WIN',
}

export type ResolutionMethod = 'code' | 'legacy-alias' | 'full-name' | 'alias'

export interface Resolution {
  tag: string
  code: string
  method: ResolutionMethod
}

/** Resolves a tag to a code, or null when nothing here knows it. Never invents one. */
export function resolvePlatformTag(tag: string): Resolution | null {
  const trimmed = tag.trim()
  const lower = trimmed.toLowerCase()

  const key = platformKey(trimmed)
  if (PLATFORM_ORDER.includes(key)) {
    return { tag, code: platformCode(trimmed), method: key === lower ? 'code' : 'legacy-alias' }
  }

  const byName = NAME_TO_CODE.get(lower)
  if (byName) return { tag, code: byName, method: 'full-name' }

  const alias = EXTRA_ALIASES[lower]
  if (alias) return { tag, code: alias, method: 'alias' }

  return null
}

export interface TagReport {
  resolved: Resolution[]
  /** Already the right code; nothing to report, nothing to rewrite. */
  unchanged: string[]
  /** Not a code, a legacy tag, a full name, or a known alias — left exactly as written. */
  unresolved: string[]
}

export function checkTags(tags: readonly string[]): TagReport {
  const resolved: Resolution[] = []
  const unchanged: string[] = []
  const unresolved: string[] = []

  for (const tag of tags) {
    const hit = resolvePlatformTag(tag)
    if (!hit) {
      unresolved.push(tag)
    } else if (hit.code === tag.trim()) {
      unchanged.push(tag)
    } else {
      resolved.push(hit)
    }
  }

  return { resolved, unchanged, unresolved }
}

/**
 * Rewrites every `tags:` block in `text` (flow style `[A, B]` and block style
 * `- A` / `- B`) by replacing each token with `resolvePlatformTag`'s code.
 * A token nothing resolves is left byte-for-byte as written. Operates on the
 * raw text rather than re-serializing the parsed document, so a comment, a
 * quoting choice, or a field this script does not know about is never
 * touched.
 */
export function rewriteTagBlocks(text: string): string {
  const withFlowFixed = text.replace(/tags:(\s*)\[([^\]]*)\]/g, (whole, gap: string, inner: string) => {
    if (inner.trim() === '') return whole
    const tokens = inner.split(',').map((token) => {
      const raw = token.trim()
      const unquoted = raw.replace(/^["']|["']$/g, '')
      const hit = resolvePlatformTag(unquoted)
      return hit ? hit.code : raw
    })
    return `tags:${gap}[${tokens.join(', ')}]`
  })

  return withFlowFixed.replace(/tags:(\r?\n(?:[ \t]*-[ \t]*\S[^\r\n]*\r?\n?)+)/g, (whole, block: string) => {
    const fixedBlock = block.replace(/^([ \t]*-[ \t]*)(\S[^\r\n]*)$/gm, (line, prefix: string, value: string) => {
      const unquoted = value.trim().replace(/^["']|["']$/g, '')
      const hit = resolvePlatformTag(unquoted)
      return hit ? `${prefix}${hit.code}` : line
    })
    return `tags:${fixedBlock}`
  })
}

function platformCategories(): ReadonlySet<string> {
  const registry = createMediaTypeRegistry()
  return new Set(registry.list().filter((type) => type.facets?.some((facet) => facet.key === 'platform')).map((type) => type.key))
}

function methodLabel(method: ResolutionMethod): string {
  switch (method) {
    case 'legacy-alias':
      return 'an old tag the app still reads'
    case 'full-name':
      return "the platform's full name"
    case 'alias':
      return 'a common nickname'
    case 'code':
      return 'the right code, different case'
  }
}

if (isRunDirectly(import.meta.url)) {
  const args = process.argv.slice(2)
  const write = args.includes('--write')
  const paths = args.filter((arg) => arg !== '--write')

  if (paths.length === 0) {
    console.log('Usage: npx tsx lists/normalize-platform-tags.ts [--write] <file.yaml> [file.yaml ...]')
    process.exit(1)
  }

  const validCategories = new Set(createMediaTypeRegistry().keys())
  const gameLike = platformCategories()
  let anyUnresolved = false

  for (const path of paths) {
    const text = readFileSync(path, 'utf8')

    let parsed
    try {
      parsed = parseCustomList(text, validCategories)
    } catch (error) {
      console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      anyUnresolved = true
      continue
    }

    if (!gameLike.has(parsed.category)) {
      console.log(`${path}: category "${parsed.category}" has no platform facet, skipping`)
      continue
    }

    let touched = false
    for (const [index, item] of parsed.items.entries()) {
      const { resolved, unresolved } = checkTags(item.tags ?? [])
      const named = `item ${index + 1} ("${item.title}")`
      for (const hit of resolved) {
        console.log(`${path}: ${named}: "${hit.tag}" -> ${hit.code} (${methodLabel(hit.method)})`)
        touched = true
      }
      for (const tag of unresolved) {
        console.log(`${path}: ${named}: "${tag}" is not a known platform, code, or alias — leaving it as written`)
        anyUnresolved = true
      }
    }

    if (write && touched) {
      writeFileSync(path, rewriteTagBlocks(text))
      console.log(`${path}: wrote fixes`)
    } else if (!write && touched) {
      console.log(`${path}: run again with --write to apply the fixes above`)
    }
  }

  if (anyUnresolved) {
    console.log('\nSome tags were left unresolved — fix them by hand, then run npx tsx server/src/tools/validateLists.ts on the file.')
    process.exitCode = 1
  }
}
