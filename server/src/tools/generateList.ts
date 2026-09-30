import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from '../config.js'
import {
  createMediaTypeRegistry,
  type ListSource,
  type MediaTypeCandidate,
  type MediaTypeRegistry,
} from '../ingestion/mediaTypes.js'

/**
 * Drafts a `lists/` YAML file from a live search adapter, instead of typing
 * every title/year/runtime by hand.
 *
 * Two steps, deliberately not one — same split as `SearchAdapter` itself
 * (`mediaTypes.ts`): run in search mode first to find the right
 * `externalRef` (a franchise keyword, an artist, a filmography), then run
 * again in generate mode with that ref to actually write the file. This
 * project's own history (docs/DECISIONS.md) is full of adapters that return
 * more than one plausible match for a name, so picking one is a step a human
 * should see, not skip.
 *
 * This never writes to `lists/index.json` and never commits anything — the
 * owner reviews and hand-curates every generated file before it becomes a
 * real list (trimming it down to a specific watch order, dropping items,
 * renaming it), the same way any other `lists/` PR is reviewed. See
 * `generateListsIndex.ts` for the separate manifest-regeneration step.
 */

const LISTS_DIR = fileURLToPath(new URL('../../../lists', import.meta.url))

export interface GenerateListOptions {
  category: string
  query?: string
  ref?: string
  title?: string
  out?: string
  force?: boolean
}

export interface SearchModeResult {
  mode: 'search'
  results: ListSource[]
  warning?: string
}

export interface GenerateModeResult {
  mode: 'generate'
  path: string
  itemCount: number
  warning?: string
}

/**
 * Sources whose API terms forbid redistributing what they return (TMDB: no
 * sublicensing, no caching past six months; Comic Vine: non-commercial only;
 * IGDB: commercial use needs a partnership). A draft from one of them is
 * their data, and `lists/` is published under CC BY 4.0, so it cannot go into
 * the List Vault as it is (NOTICE.md, CONTRIBUTING.md; owner, 2026-09-30).
 * The tool still runs: a private draft is fine, contributing it is not.
 */
const NO_REDISTRIBUTION = new Set(['TMDB', 'IGDB', 'Comic Vine'])

function redistributionWarning(sourceName: string | undefined): string | undefined {
  if (!sourceName || !NO_REDISTRIBUTION.has(sourceName)) return undefined
  return (
    `This draft is ${sourceName} data: ${sourceName}'s terms forbid redistributing it, so it cannot be contributed ` +
    `to lists/ (CC BY 4.0) as it is. Write the list from your own knowledge or another source. See NOTICE.md.`
  )
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'
  )
}

function candidateToItem(candidate: MediaTypeCandidate): Record<string, unknown> {
  const item: Record<string, unknown> = { title: candidate.title }
  if (candidate.year !== undefined) item['year'] = candidate.year
  if (candidate.timeToConsumeMinutes !== undefined) item['minutes'] = candidate.timeToConsumeMinutes
  if (candidate.group !== undefined) item['group'] = candidate.group
  if (candidate.tags !== undefined) item['tags'] = candidate.tags
  return item
}

/**
 * Always double-quotes, rather than leaving `js-yaml`'s `dump()` decide per
 * string whether a title needs quoting (it only quotes when a bare value
 * would be genuinely ambiguous, e.g. a title containing ": "). That is
 * correct YAML — CONTRIBUTING.md's own hand-written examples follow the
 * same "quote only when necessary" rule — but a machine-generated file with
 * some titles quoted and others not reads as inconsistent/broken to a human
 * reviewing hundreds of them at a glance, which is exactly what happened
 * (the owner flagged "UFC 100" and "UFC Fight Night 6" as looking
 * mis-formatted next to "UFC 2: No Way Out"). `JSON.stringify` produces a
 * valid YAML double-quoted scalar for any realistic title — the escaping
 * rules for `"`, `\`, and control characters coincide.
 */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

function formatItemLine(item: Record<string, unknown>): string {
  const parts: string[] = [`title: ${yamlString(item['title'] as string)}`]
  if (item['year'] !== undefined) parts.push(`year: ${String(item['year'])}`)
  if (item['minutes'] !== undefined) parts.push(`minutes: ${String(item['minutes'])}`)
  if (item['group'] !== undefined) parts.push(`group: ${yamlString(item['group'] as string)}`)
  if (item['tags'] !== undefined) {
    const tags = (item['tags'] as string[]).map(yamlString).join(', ')
    parts.push(`tags: [${tags}]`)
  }
  return `  - {${parts.join(', ')}}`
}

export async function runGenerateList(
  options: GenerateListOptions,
  registry: MediaTypeRegistry,
): Promise<SearchModeResult | GenerateModeResult> {
  const mediaType = registry.get(options.category)
  if (!mediaType) {
    throw new Error(
      `Unknown category "${options.category}". Known categories: ${registry.keys().join(', ')}`,
    )
  }
  if (!mediaType.adapter) {
    throw new Error(`Category "${options.category}" has no search adapter — nothing to generate from.`)
  }
  if (!mediaType.adapter.isAvailable()) {
    throw new Error(
      `Category "${options.category}"'s adapter is unavailable, usually a missing API key in .env.`,
    )
  }

  const warning = redistributionWarning(mediaType.sourceName)

  if (!options.ref) {
    if (!options.query) throw new Error('Pass --query to search, or --ref to generate directly.')
    const results = await mediaType.adapter.search(options.query)
    return { mode: 'search', results, ...(warning ? { warning } : {}) }
  }

  if (!options.title) throw new Error('Pass --title for the generated list — required in generate mode.')

  const { items: candidates } = await mediaType.adapter.expand(options.ref)
  const itemLines = candidates.map(candidateToItem).map(formatItemLine).join('\n')

  const generatedComment = `# Generated ${new Date().toISOString().slice(0, 10)} by \`generateList.ts\` (--category ${options.category} --ref ${options.ref}).\n# Draft only — review titles/years/minutes and prune/reorder before committing.\n${warning ? `# ${warning}\n` : ''}`
  const yamlText = `${generatedComment}title: ${yamlString(options.title)}\ncategory: ${options.category}\nitems:\n${itemLines}\n`

  const outPath = options.out ?? `${LISTS_DIR}/${options.category}/${slugify(options.title)}.yaml`
  if (existsSync(outPath) && !options.force) {
    throw new Error(`${outPath} already exists — pass --force to overwrite.`)
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, yamlText)

  return { mode: 'generate', path: outPath, itemCount: candidates.length, ...(warning ? { warning } : {}) }
}

function parseArgs(argv: string[]): GenerateListOptions {
  const options: Partial<GenerateListOptions> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      options.force = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value.`)
    if (arg === '--category') options.category = value
    else if (arg === '--query') options.query = value
    else if (arg === '--ref') options.ref = value
    else if (arg === '--title') options.title = value
    else if (arg === '--out') options.out = value
    else throw new Error(`Unknown argument: ${arg}`)
    i += 1
  }
  if (!options.category) {
    throw new Error(
      'Usage: tsx generateList.ts --category <key> --query <text>\n' +
        '   or: tsx generateList.ts --category <key> --ref <externalRef> --title <text> [--out path] [--force]',
    )
  }
  return options as GenerateListOptions
}

async function main(): Promise<void> {
  loadEnvFile()
  const options = parseArgs(process.argv.slice(2))
  const registry = createMediaTypeRegistry()

  const result = await runGenerateList(options, registry)
  if (result.warning) console.warn(`Warning: ${result.warning}\n`)

  if (result.mode === 'search') {
    if (result.results.length === 0) {
      console.log('No results.')
      return
    }
    console.log(`${result.results.length} result(s) — re-run with --ref <ref> --title <text> to generate:\n`)
    for (const source of result.results) {
      console.log(`  ${source.externalRef}  ${source.title}${source.detail ? `  (${source.detail})` : ''}`)
    }
  } else {
    console.log(`Wrote ${result.itemCount} item(s) to ${result.path} — review before committing.`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
