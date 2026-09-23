import { readFileSync } from 'node:fs'
import { parseCustomList } from '../ingestion/customLists.js'
import { createMediaTypeRegistry } from '../ingestion/mediaTypes.js'

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
export function validateListFiles(paths: string[], validCategories: ReadonlySet<string>): string[] {
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
      parseCustomList(text, validCategories)
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

  const validCategories = new Set(createMediaTypeRegistry().keys())
  const errors = validateListFiles(paths, validCategories)

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
