import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCustomList, type CanonicalListEntry } from '../ingestion/customLists.js'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'

/**
 * Regenerates `lists/index.json` by scanning every `lists/**\/*.yaml` file,
 * rather than the hand-maintained-by-whoever-merges-a-PR process
 * `CONTRIBUTING.md` currently documents. Written for a library expected to
 * grow continuously (see the franchise-library thread) — hand-editing a
 * manifest does not scale the way a generated one does.
 *
 * Reuses `parseCustomList` unchanged, so a file that would be rejected by the
 * app at sync time is rejected here too, before it ever reaches
 * `lists/index.json` — the same validation, run earlier.
 */

const LISTS_DIR = fileURLToPath(new URL('../../../lists', import.meta.url))
const INDEX_PATH = `${LISTS_DIR}/index.json`

function findYamlFiles(dir: string, base = dir): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...findYamlFiles(full, base))
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      found.push(full.slice(base.length + 1))
    }
  }
  return found
}

export function generateListsIndex(listsDir: string, validCategories: ReadonlySet<string>): CanonicalListEntry[] {
  const entries = findYamlFiles(listsDir)
    .sort()
    .map((relativePath): CanonicalListEntry => {
      const text = readFileSync(`${listsDir}/${relativePath}`, 'utf8')
      let parsed
      try {
        parsed = parseCustomList(text, validCategories)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`lists/${relativePath} failed to parse: ${reason}`, { cause: error })
      }
      return {
        path: `lists/${relativePath}`,
        title: parsed.title,
        category: parsed.category,
        itemCount: parsed.items.length,
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      }
    })

  return entries
}

function main(): void {
  const validCategories = new Set(createMediaTypeRegistry().keys())
  const entries = generateListsIndex(LISTS_DIR, validCategories)
  writeFileSync(INDEX_PATH, `${JSON.stringify(entries, null, 2)}\n`)
  console.log(`Wrote ${entries.length} entries to lists/index.json`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main()
  } catch (error) {
    // The message names the file and what is wrong with it; a stack trace would only bury it.
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
