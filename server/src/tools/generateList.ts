import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as dumpYaml } from 'js-yaml'
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
}

export interface GenerateModeResult {
  mode: 'generate'
  path: string
  itemCount: number
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
  return item
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

  if (!options.ref) {
    if (!options.query) throw new Error('Pass --query to search, or --ref to generate directly.')
    const results = await mediaType.adapter.search(options.query)
    return { mode: 'search', results }
  }

  if (!options.title) throw new Error('Pass --title for the generated list — required in generate mode.')

  const candidates = await mediaType.adapter.expand(options.ref)
  const doc = {
    title: options.title,
    category: options.category,
    items: candidates.map(candidateToItem),
  }

  const generatedComment = `# Generated ${new Date().toISOString().slice(0, 10)} by \`generateList.ts\` (--category ${options.category} --ref ${options.ref}).\n# Draft only — review titles/years/minutes and prune/reorder before committing.\n`
  const yamlText = generatedComment + dumpYaml(doc, { flowLevel: 2, lineWidth: 100 })

  const outPath = options.out ?? `${LISTS_DIR}/${options.category}/${slugify(options.title)}.yaml`
  if (existsSync(outPath) && !options.force) {
    throw new Error(`${outPath} already exists — pass --force to overwrite.`)
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, yamlText)

  return { mode: 'generate', path: outPath, itemCount: candidates.length }
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
