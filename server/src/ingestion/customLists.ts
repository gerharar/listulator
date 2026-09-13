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
