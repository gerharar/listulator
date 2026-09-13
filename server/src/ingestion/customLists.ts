import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import type { ApiErrorCode } from '../apiErrors.js'

export interface ParsedCustomListItem {
  title: string
  year?: number
  minutes?: number
  group?: string
}

export interface ParsedCustomList {
  title: string
  category: string
  items: ParsedCustomListItem[]
}

type CustomListErrorCode = Extract<
  ApiErrorCode,
  'list.fileInvalid' | 'list.fileMissingTitle' | 'list.unknownCategory' | 'list.fileItemMissingTitle'
>

export class CustomListParseError extends Error {
  constructor(
    readonly code: CustomListErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super(code)
    this.name = 'CustomListParseError'
  }
}

const TOP_LEVEL_FIELDS = new Set(['title', 'category', 'items'])
const ITEM_FIELDS = new Set(['title', 'year', 'minutes', 'group'])

function fail(code: CustomListErrorCode, params?: Record<string, string | number>): never {
  throw new CustomListParseError(code, params)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parses and validates a custom-list YAML file (`docs/intent/custom-lists.md`).
 *
 * `js-yaml`'s default `load()` is the safe loader as of v4 — no custom tags,
 * no executable content — which is the whole safety guarantee this format
 * relies on. Never pass `schema: DEFAULT_FULL_SCHEMA` or otherwise widen it.
 *
 * `validCategories` comes from the live media-type registry, not a hardcoded
 * list — `media_type` is an open registry (CLAUDE.md), and this format must
 * not need a code change here whenever a category is added elsewhere.
 */
export function parseCustomList(
  yamlText: string,
  validCategories: ReadonlySet<string>,
): ParsedCustomList {
  let doc: unknown
  try {
    doc = loadYaml(yamlText)
  } catch {
    fail('list.fileInvalid')
  }

  if (!isPlainObject(doc)) fail('list.fileInvalid')

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_FIELDS.has(key)) fail('list.fileInvalid')
  }

  const { title, category, items } = doc

  if (typeof title !== 'string' || title.trim().length === 0) fail('list.fileMissingTitle')

  if (category === undefined) fail('list.fileInvalid')
  if (typeof category !== 'string' || !validCategories.has(category)) {
    fail('list.unknownCategory', { key: String(category) })
  }

  if (!Array.isArray(items)) fail('list.fileInvalid')

  const parsedItems = items.map((rawItem, index): ParsedCustomListItem => {
    if (!isPlainObject(rawItem)) fail('list.fileInvalid')

    for (const key of Object.keys(rawItem)) {
      if (!ITEM_FIELDS.has(key)) fail('list.fileInvalid')
    }

    const { title: itemTitle, year, minutes, group } = rawItem

    if (typeof itemTitle !== 'string' || itemTitle.trim().length === 0) {
      fail('list.fileItemMissingTitle', { index: index + 1 })
    }
    if (year !== undefined && typeof year !== 'number') fail('list.fileInvalid')
    if (minutes !== undefined && typeof minutes !== 'number') fail('list.fileInvalid')
    if (group !== undefined && typeof group !== 'string') fail('list.fileInvalid')

    return {
      title: itemTitle,
      ...(year !== undefined ? { year } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
      ...(group !== undefined ? { group } : {}),
    }
  })

  return { title: title.trim(), category, items: parsedItems }
}

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
  result: { ok: true; list: ParsedCustomList } | { ok: false; error: CustomListParseError }
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
      return { fileName, result: { ok: true, list } }
    } catch (error) {
      if (!(error instanceof CustomListParseError)) throw error
      moveInto(dropDir, REFUSED_SUBDIR, fileName)
      return { fileName, result: { ok: false, error } }
    }
  })
}
