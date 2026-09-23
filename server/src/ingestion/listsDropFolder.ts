// Split out from customLists.ts (task 7.4 bugfix): this file is the only
// part of the custom-list machinery that touches `node:fs`. Keeping it
// separate from customLists.ts matters — that module is imported directly
// by web/src/lib/api.local.ts for the standalone app, and Vite's browser
// bundler eagerly evaluates *every* named import of a Node builtin at
// module load, even one this file never calls. A `node:fs` import
// anywhere in customLists.ts silently broke the entire standalone app at
// startup (`Cannot access "node:fs.existsSync" in client code`) from the
// moment task 7.3 added it — caught only now, live-testing task 7.4,
// because nothing had relaunched the desktop app in between. Full writeup
// in docs/DECISIONS.md.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CustomListParseError, parseCustomList, type ParsedCustomList } from './customLists.js'

const DEFAULT_LISTS_DROP_DIR = fileURLToPath(new URL('../../list_customs', import.meta.url))

/** `<repo>/server/list_customs` by default (task 7.3) — override with `LISTS_DROP_DIR`. */
export function listsDropDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['LISTS_DROP_DIR'] ?? DEFAULT_LISTS_DROP_DIR
}

const ADMITTED_SUBDIR = 'admitted'
const REFUSED_SUBDIR = 'refused_entry'
const YAML_EXTENSIONS = new Set(['.yaml', '.yml'])

export interface DroppedListOutcome {
  fileName: string
  result:
    | { ok: true; list: ParsedCustomList; rawText: string }
    | { ok: false; error: CustomListParseError }
}

/** Moves `fileName` into `<dropDir>/<subdir>`, appending `-2`, `-3`, … on a name collision. */
function moveInto(dropDir: string, subdir: string, fileName: string): void {
  const targetDir = join(dropDir, subdir)
  mkdirSync(targetDir, { recursive: true })

  const ext = extname(fileName)
  const base = fileName.slice(0, fileName.length - ext.length)

  let destination = join(targetDir, fileName)
  for (let counter = 2; existsSync(destination); counter++) {
    destination = join(targetDir, `${base}-${counter}${ext}`)
  }

  renameSync(join(dropDir, fileName), destination)
}

/**
 * Scans the configured drop folder (task 7.3, `docs/intent/custom-lists.md`)
 * for `.yaml`/`.yml` files, parsing each with `parseCustomList`. A file that
 * parses successfully moves to `admitted/`; one that doesn't moves to
 * `refused_entry/` — either way it never sits in the main folder to be
 * reprocessed on the next scan, which is what keeps repeated scans from
 * re-importing the same file forever. Only the drop folder's own direct
 * contents are candidates — `admitted/` and `refused_entry/` are output
 * locations, never rescanned as input.
 *
 * Pure filesystem + parsing, no database access, matching `parseCustomList`
 * itself — the caller (the route handler) creates the actual list from each
 * successfully-parsed result.
 */
export function scanListsDropFolder(
  dropDir: string,
  validCategories: ReadonlySet<string>,
): DroppedListOutcome[] {
  mkdirSync(dropDir, { recursive: true })

  const fileNames = readdirSync(dropDir)
    .filter((name) => YAML_EXTENSIONS.has(extname(name).toLowerCase()))
    .filter((name) => statSync(join(dropDir, name)).isFile())
    .sort()

  return fileNames.map((fileName): DroppedListOutcome => {
    const text = readFileSync(join(dropDir, fileName), 'utf8')

    try {
      const list = parseCustomList(text, validCategories)
      moveInto(dropDir, ADMITTED_SUBDIR, fileName)
      return { fileName, result: { ok: true, list, rawText: text } }
    } catch (error) {
      if (!(error instanceof CustomListParseError)) throw error
      moveInto(dropDir, REFUSED_SUBDIR, fileName)
      return { fileName, result: { ok: false, error } }
    }
  })
}
