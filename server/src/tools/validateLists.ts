import { readFileSync } from 'node:fs'
import { parseCustomList } from '../ingestion/customLists.js'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'
import { LEGACY_PLATFORM_TAGS, PLATFORM_ORDER } from '../catalog/platforms.js'

/**
 * Validates each of `paths` through the real parser (task 10.2d) — the same
 * one the app itself uses, not a second validator. Used by `scripts/pre-commit`
 * to catch a malformed `lists/*.yaml` file before it's committed, and
 * runnable by hand.
 *
 * Collects every error rather than stopping at the first, so a commit
 * touching several files gets one report naming all of them, not a fix-one
 * re-run-and-find-the-next loop.
 */
/**
 * A curated list in a category whose tags are platforms (Games) must use the
 * codes in `config/platforms.csv` (10.24c), in any case (no `multi`: owner, U5). An old code
 * the app still reads (PC) is refused here, with today's code named, so the
 * library never drifts from the table. The app's own import stays lenient.
 */
function platformErrors(items: readonly { title: string; tags?: string[] }[]): string[] {
  const errors: string[] = []
  for (const item of items) {
    const bad = (item.tags ?? []).filter((tag) => !PLATFORM_ORDER.includes(tag.trim().toLowerCase()))
    if (bad.length === 0) continue
    const named = bad.map((tag) => {
      const today = LEGACY_PLATFORM_TAGS[tag.trim().toLowerCase()]
      return today ? `${tag} (now ${today})` : tag
    })
    errors.push(`item "${item.title}" has platform codes not in config/platforms.csv: ${named.join(', ')}`)
  }
  return errors
}

export function validateListFiles(
  paths: string[],
  validCategories: ReadonlySet<string>,
  /** Categories whose tags are platform codes, from the registry's facets. */
  platformCategories: ReadonlySet<string> = new Set(),
): string[] {
  const errors: string[] = []

  for (const path of paths) {
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      errors.push(`${path}: could not be read (${error instanceof Error ? error.message : String(error)})`)
      continue
    }

    try {
      const parsed = parseCustomList(text, validCategories)
      if (platformCategories.has(parsed.category)) {
        for (const problem of platformErrors(parsed.items)) errors.push(`${path}: ${problem}`)
      }
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return errors
}

function main(): void {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.log('validateLists: no files given.')
    return
  }

  const registry = createMediaTypeRegistry()
  const validCategories = new Set(registry.keys())
  const platformCategories = new Set(
    registry.list().filter((type) => type.facets?.some((facet) => facet.key === 'platform')).map((type) => type.key),
  )
  const errors = validateListFiles(paths, validCategories, platformCategories)

  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
    return
  }

  console.log(`validateLists: ${paths.length} file(s) OK.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
