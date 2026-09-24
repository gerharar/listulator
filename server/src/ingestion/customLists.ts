import { load as loadYaml } from 'js-yaml'
import type { ApiErrorCode } from '../apiErrors.js'
import { getJson, getText, IngestionError, type FetchLike } from './http.js'
import type { ListExpansion } from './mediaTypes.js'

// No `node:fs`/`node:path`/`node:url` imports in this file, ever — it is
// imported directly by web/src/lib/api.local.ts for the standalone app, and
// Vite's browser bundler breaks the whole app the moment any Node builtin is
// imported anywhere in a module it has to bundle, even an export nothing on
// the browser side calls (see docs/DECISIONS.md, task 7.4's regression
// writeup). Folder-scanning (task 7.3, genuinely fs-dependent, server-only)
// lives in the sibling `listsDropFolder.ts` instead.

export interface ParsedCustomListItem {
  title: string
  year?: number
  minutes?: number
  group?: string
  tags?: string[]
  /** Curator-authored disambiguation prose, capped at `ITEM_NOTES_MAX_LENGTH`. */
  notes?: string
}

export interface ParsedCustomList {
  title: string
  /** A longer free-text blurb alongside `title`. Undefined if not set. */
  description?: string
  category: string
  /**
   * Production status of the thing the list is about — 'complete' or
   * 'ongoing', undefined means unknown. Never the user's own consumption
   * progress (that's derived elsewhere, unrelated on purpose).
   */
  status?: 'complete' | 'ongoing'
  items: ParsedCustomListItem[]
}

type CustomListErrorCode = Extract<
  ApiErrorCode,
  | 'list.fileInvalid'
  | 'list.fileMissingTitle'
  | 'list.unknownCategory'
  | 'list.fileItemMissingTitle'
  | 'list.fileItemNotesTooLong'
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

const TOP_LEVEL_FIELDS = new Set(['title', 'description', 'category', 'status', 'items'])
const ITEM_FIELDS = new Set(['title', 'year', 'minutes', 'group', 'tags', 'notes'])

/** Curator-authored prose, not a document — refused rather than truncated over this. */
export const ITEM_NOTES_MAX_LENGTH = 2048

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

  const { title, description, category, status, items } = doc

  if (typeof title !== 'string' || title.trim().length === 0) fail('list.fileMissingTitle')

  if (description !== undefined && typeof description !== 'string') fail('list.fileInvalid')

  if (category === undefined) fail('list.fileInvalid')
  if (typeof category !== 'string' || !validCategories.has(category)) {
    fail('list.unknownCategory', { key: String(category) })
  }

  if (status !== undefined && status !== 'complete' && status !== 'ongoing') {
    fail('list.fileInvalid')
  }

  if (!Array.isArray(items)) fail('list.fileInvalid')

  const parsedItems = items.map((rawItem, index): ParsedCustomListItem => {
    if (!isPlainObject(rawItem)) fail('list.fileInvalid')

    for (const key of Object.keys(rawItem)) {
      if (!ITEM_FIELDS.has(key)) fail('list.fileInvalid')
    }

    const { title: itemTitle, year, minutes, group, tags, notes } = rawItem

    if (typeof itemTitle !== 'string' || itemTitle.trim().length === 0) {
      fail('list.fileItemMissingTitle', { index: index + 1 })
    }
    if (year !== undefined && typeof year !== 'number') fail('list.fileInvalid')
    if (minutes !== undefined && typeof minutes !== 'number') fail('list.fileInvalid')
    if (group !== undefined && typeof group !== 'string') fail('list.fileInvalid')
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))) {
      fail('list.fileInvalid')
    }
    if (notes !== undefined && typeof notes !== 'string') fail('list.fileInvalid')

    const trimmedNotes = typeof notes === 'string' ? notes.trim() : undefined
    if (trimmedNotes !== undefined && trimmedNotes.length > ITEM_NOTES_MAX_LENGTH) {
      fail('list.fileItemNotesTooLong', { index: index + 1, max: ITEM_NOTES_MAX_LENGTH })
    }

    return {
      title: itemTitle,
      ...(year !== undefined ? { year } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
      ...(group !== undefined ? { group } : {}),
      ...(tags !== undefined ? { tags: tags as string[] } : {}),
      ...(trimmedNotes !== undefined ? { notes: trimmedNotes } : {}),
    }
  })

  return {
    title: title.trim(),
    ...(description !== undefined ? { description: description.trim() } : {}),
    category,
    ...(status !== undefined ? { status } : {}),
    items: parsedItems,
  }
}

/**
 * The canonical list repo (task 7.4, `docs/intent/custom-lists.md`).
 * Hardcoded, on purpose — never configurable. Trusting sync to point
 * somewhere else would defeat the entire point of "every list came through
 * the owner's PR review."
 */
const CANONICAL_REPO_OWNER = 'neuroshaoh'
const CANONICAL_REPO_NAME = 'listulator'
const CANONICAL_REPO_BRANCH = 'main'

function canonicalRawUrl(path: string): string {
  return `https://raw.githubusercontent.com/${CANONICAL_REPO_OWNER}/${CANONICAL_REPO_NAME}/${CANONICAL_REPO_BRANCH}/${path}`
}

/**
 * Rejects anything that isn't a plain, relative path inside the repo —
 * independent of, and in addition to, checking the path is actually one the
 * manifest lists. `raw.githubusercontent.com/.../main/` + a path containing
 * `..` can normalize to a different repo/host entirely, which would defeat
 * the "hardcoded to the canonical repo, never configurable" trust boundary
 * even though the manifest-membership check on its own looks sufficient.
 */
export function isSafeCanonicalPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\')) return false
  if (path.includes(':')) return false
  return path.split('/').every((segment) => segment !== '..' && segment !== '.')
}

export interface CanonicalListEntry {
  path: string
  title: string
  category: string
  /** A longer free-text blurb, mirrored from the list file's own `description`. Absent if unset. */
  description?: string
  /** Production status of the thing the list is about, mirrored from the file's own `status`. Absent if unset. */
  status?: 'complete' | 'ongoing'
}

function isCanonicalListEntry(value: unknown): value is CanonicalListEntry {
  return (
    isPlainObject(value) &&
    typeof value['path'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['category'] === 'string' &&
    isSafeCanonicalPath(value['path']) &&
    // Both optional, so a manifest generated before this field existed still
    // validates — an older index.json simply omits them.
    (value['description'] === undefined || typeof value['description'] === 'string') &&
    (value['status'] === undefined || value['status'] === 'complete' || value['status'] === 'ongoing')
  )
}

/** Fetches and validates `lists/index.json` from the canonical repo. */
export async function fetchCanonicalManifest(fetchImpl?: FetchLike): Promise<CanonicalListEntry[]> {
  const manifest = await getJson<unknown>(canonicalRawUrl('lists/index.json'), {
    source: 'the canonical list repository',
    ...(fetchImpl ? { fetchImpl } : {}),
  })

  if (!Array.isArray(manifest) || !manifest.every(isCanonicalListEntry)) {
    throw new IngestionError('The canonical list repository returned a malformed manifest.')
  }

  return manifest
}

/** `externalRef` prefix marking a list synced from the canonical repo (tasks 7.4/7.5). */
const CANONICAL_REF_PREFIX = 'canonical:'

export function canonicalExternalRef(path: string): string {
  return `${CANONICAL_REF_PREFIX}${path}`
}

/** The reverse of `canonicalExternalRef` — `undefined` for any other kind of ref. */
export function canonicalPathFromExternalRef(externalRef: string | null): string | undefined {
  return externalRef?.startsWith(CANONICAL_REF_PREFIX)
    ? externalRef.slice(CANONICAL_REF_PREFIX.length)
    : undefined
}

/**
 * Fetches and parses one specific file from the canonical repo by its
 * manifest path. Reuses `parseCustomList` unchanged — same format, same
 * validation, whether the file arrived by paste, upload, folder-drop, or
 * sync.
 */
export async function fetchCanonicalList(
  path: string,
  validCategories: ReadonlySet<string>,
  fetchImpl?: FetchLike,
): Promise<ParsedCustomList> {
  const text = await getText(canonicalRawUrl(path), {
    source: 'the canonical list repository',
    ...(fetchImpl ? { fetchImpl } : {}),
  })

  return parseCustomList(text, validCategories)
}

/**
 * The actual confirmed intent behind canonical lists (task 7.4): searching
 * within a category also matches canonical-repo list titles in that same
 * category, merged into the existing search results — not a separate browse
 * UI (that idea was deliberately deferred to its own future task).
 *
 * Degrades silently to no matches on a fetch failure — including the repo
 * being genuinely unreachable right now, since it is private — rather than
 * breaking search for every other category's real adapter. A canonical
 * match is additive on top of normal search, never a replacement for it, so
 * losing it to a transient GitHub problem should not cost anything else.
 */
export async function searchCanonicalLists(
  category: string,
  query: string,
  fetchImpl?: FetchLike,
): Promise<
  {
    externalRef: string
    title: string
    detail: string
    description?: string
    status?: 'complete' | 'ongoing'
  }[]
> {
  let manifest: CanonicalListEntry[]
  try {
    manifest = await fetchCanonicalManifest(fetchImpl)
  } catch (error) {
    if (error instanceof IngestionError) return []
    throw error
  }

  const normalizedQuery = query.trim().toLowerCase()

  return manifest
    .filter(
      (entry) => entry.category === category && entry.title.toLowerCase().includes(normalizedQuery),
    )
    .map((entry) => ({
      externalRef: canonicalExternalRef(entry.path),
      title: entry.title,
      detail: 'Canonical list',
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
    }))
}

/**
 * The `expand()`-shaped refetch for a synced canonical list (task 7.5) —
 * same `ListExpansion` shape every adapter's `expand()` returns, so
 * `/lists/:listId/refresh`'s existing new-item matching needs no changes to
 * handle it. No per-item `externalRef`: a custom-list file carries no stable
 * upstream id per item (only the file's own path identifies the list as a
 * whole), so matching falls back to title alone — the same rule already
 * applied to Wikipedia events and Open Library works.
 *
 * Unlike `searchCanonicalLists`, a fetch failure here is not swallowed: this
 * runs only when the user explicitly asked to check a specific synced list
 * for updates, the same reasoning `/lists/from-source`'s canonical branch
 * uses for its own 502 (docs/DECISIONS.md, task 7.4).
 */
export async function expandCanonicalList(
  path: string,
  validCategories: ReadonlySet<string>,
  fetchImpl?: FetchLike,
): Promise<ListExpansion> {
  const parsed = await fetchCanonicalList(path, validCategories, fetchImpl)

  const items = parsed.items.map((item) => ({
    title: item.title,
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(item.minutes !== undefined ? { timeToConsumeMinutes: item.minutes } : {}),
    ...(item.group !== undefined ? { group: item.group } : {}),
    ...(item.tags !== undefined ? { tags: item.tags } : {}),
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
  }))

  // The curator's own top-level `status`, when the file sets one.
  return { items, ...(parsed.status !== undefined ? { status: parsed.status } : {}) }
}
