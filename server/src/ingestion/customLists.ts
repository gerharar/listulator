import { load as loadYaml, YAMLException } from 'js-yaml'
import type { ApiErrorCode } from '../apiErrors.js'
import {
  DESCRIPTION_MAX_LENGTH,
  LIST_FILE_MAX_CHARS,
  MAX_LIST_ITEMS,
  MINUTES_RANGE,
  NAME_MAX_LENGTH,
  TAG_MAX_LENGTH,
  TAGS_MAX,
  validMinutes,
  validYear,
  YEAR_RANGE,
} from '../catalog/limits.js'
import { getJson, getText, IngestionError, type FetchLike } from './http.js'
import type { ListExpansion } from './mediaTypes.js'
import { textHazard, withoutHazards } from './textHazards.js'

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
  | 'list.fileSyntax'
  | 'list.fileNoItems'
  | 'list.fileMissingTitle'
  | 'list.unknownCategory'
  | 'list.fileItemMissingTitle'
  | 'list.fileItemNotesTooLong'
>

export class CustomListParseError extends Error {
  /**
   * The message is for whoever runs a command-line tool or reads a log (the
   * lists-index generator prints it); the app renders `code` and `params`
   * from the locale instead. English on purpose: it quotes the field names a
   * curator has to type.
   */
  constructor(
    readonly code: CustomListErrorCode,
    readonly params?: Record<string, string | number>,
  ) {
    super(`${code}: ${describeParseError(code, params)}`)
    this.name = 'CustomListParseError'
  }
}

function describeParseError(code: CustomListErrorCode, params?: Record<string, string | number>): string {
  switch (code) {
    case 'list.fileSyntax':
      return params?.['line'] === undefined ? 'YAML syntax error' : `YAML syntax error on line ${params['line']}`
    case 'list.fileNoItems':
      return 'the file has no "items"'
    case 'list.fileMissingTitle':
      return 'the list has no "title"'
    case 'list.unknownCategory':
      return `unknown category "${params?.['key']}"`
    case 'list.fileItemMissingTitle':
      return `item ${params?.['index']} has no "title"`
    case 'list.fileItemNotesTooLong':
      return `item ${params?.['index']}'s "notes" are over ${params?.['max']} characters`
    case 'list.fileInvalid':
      return typeof params?.['detail'] === 'string' ? params['detail'] : 'the file is not a valid list'
  }
}

/**
 * A file that parses but lists nothing is refused where a person hands it in
 * (the Import tab: "No items found"). Not part of `parseCustomList` itself,
 * which the community library also reads.
 */
export function requireItems(parsed: ParsedCustomList): void {
  if (parsed.items.length === 0) fail('list.fileNoItems')
}

const TOP_LEVEL_FIELDS = new Set(['title', 'description', 'category', 'status', 'items'])
const ITEM_FIELDS = new Set(['title', 'year', 'minutes', 'group', 'tags', 'notes'])

/** Curator-authored prose, not a document — refused rather than truncated over this. */
export const ITEM_NOTES_MAX_LENGTH = 2048

function fail(code: CustomListErrorCode, params?: Record<string, string | number>): never {
  throw new CustomListParseError(code, params)
}

/** A value as a curator would name it, short enough that a pasted wall of text cannot become the error. */
function describeValue(value: unknown): string {
  if (value === undefined || value === null) return 'empty'
  if (Array.isArray(value)) return 'a list'
  if (typeof value === 'string') {
    const shown = withoutHazards(value.length > 40 ? `${value.slice(0, 40)}…` : value)
    return `text "${shown}"`
  }
  if (typeof value === 'number') return `the number ${value}`
  if (typeof value === 'boolean') return `${value}`
  return 'a mapping'
}

/** The allowed field a typo most likely meant: same letters in another case, a plural, or one edit away. */
function closestField(key: string, allowed: ReadonlySet<string>): string | undefined {
  const lower = key.toLowerCase()
  for (const field of allowed) {
    if (field === lower || field === `${lower}s` || `${field}s` === lower) return field
    if (Math.abs(field.length - lower.length) <= 1 && editDistance(field, lower) <= 1) return field
  }
  return undefined
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = row
  }
  return previous[b.length]!
}

function invalid(detail: string): never {
  fail('list.fileInvalid', { detail })
}

/** A title as a message may show it: short, and with nothing in it that disguises or breaks text. */
function describeTitle(title: string): string {
  return withoutHazards(title.length > 40 ? `${title.slice(0, 40)}…` : title)
}

/**
 * One piece of text of a list file: no longer than `max` and free of what disguises or breaks text (`textHazard`). `where` names it
 * for the person who has to fix the file (`item 2 ("Safe"): "title"`), and the text itself is never put in the message.
 */
function checkText(where: string, text: string, { max, multiline = false }: { max?: number; multiline?: boolean }): void {
  if (max !== undefined && text.length > max) invalid(`${where} is over ${max} characters`)
  const hazard = textHazard(text, multiline)
  if (hazard) invalid(`${where} contains ${hazard}`)
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
  // Before anything reads it: the desktop's import had no limit at all (SR-019).
  if (yamlText.length > LIST_FILE_MAX_CHARS) invalid(`the file is over ${LIST_FILE_MAX_CHARS / (1024 * 1024)} MiB`)

  let doc: unknown
  try {
    doc = loadYaml(yamlText)
  } catch (cause) {
    // js-yaml counts lines from zero, and reports an unclosed structure at the
    // end of the text — clamped, so the line named always exists in the file.
    const lastLine = yamlText.trimEnd().split('\n').length
    const line =
      cause instanceof YAMLException && cause.mark
        ? Math.min(cause.mark.line + 1, lastLine)
        : undefined
    fail('list.fileSyntax', line === undefined ? undefined : { line })
  }

  if (!isPlainObject(doc)) invalid(`the file must be a mapping of fields, but it is ${describeValue(doc)}`)

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      invalid(`unknown top-level field "${key}" (allowed: ${[...TOP_LEVEL_FIELDS].join(', ')})`)
    }
  }

  const { title, description, category, status, items } = doc

  if (typeof title !== 'string' || title.trim().length === 0) fail('list.fileMissingTitle')
  checkText('"title"', title.trim(), { max: NAME_MAX_LENGTH })

  if (description !== undefined && typeof description !== 'string') {
    invalid(`"description" must be text, but it is ${describeValue(description)}`)
  }
  if (typeof description === 'string') checkText('"description"', description.trim(), { max: DESCRIPTION_MAX_LENGTH, multiline: true })

  if (category === undefined) invalid('"category" is missing')
  if (typeof category !== 'string' || !validCategories.has(category)) {
    fail('list.unknownCategory', { key: String(category) })
  }

  if (status !== undefined && status !== 'complete' && status !== 'ongoing') {
    invalid(`"status" must be "complete" or "ongoing", but it is ${describeValue(status)}`)
  }

  if (items === undefined) fail('list.fileNoItems')
  if (!Array.isArray(items)) invalid(`"items" must be a list, but it is ${describeValue(items)}`)
  if (items.length > MAX_LIST_ITEMS) invalid(`the list has ${items.length} items, and one list can hold at most ${MAX_LIST_ITEMS}`)

  const parsedItems = items.map((rawItem, index): ParsedCustomListItem => {
    if (!isPlainObject(rawItem)) {
      invalid(`item ${index + 1} must be a mapping like { title: …, year: … }, but it is ${describeValue(rawItem)}`)
    }

    // Names the item by position and, when it has one, by title: a long file has no line to count to.
    // Short, and without the characters this very check refuses: a 5 MB title must not become the error message.
    const named = typeof rawItem['title'] === 'string' ? `item ${index + 1} ("${describeTitle(rawItem['title'])}")` : `item ${index + 1}`

    for (const key of Object.keys(rawItem)) {
      if (!ITEM_FIELDS.has(key)) {
        const guess = closestField(key, ITEM_FIELDS)
        invalid(
          `${named}: unknown field "${key}" (allowed: ${[...ITEM_FIELDS].join(', ')})${guess ? `; did you mean "${guess}"?` : ''}`,
        )
      }
    }

    const { title: itemTitle, year, minutes, group, tags, notes } = rawItem

    if (typeof itemTitle !== 'string' || itemTitle.trim().length === 0) {
      fail('list.fileItemMissingTitle', { index: index + 1 })
    }
    if (year !== undefined && typeof year !== 'number') {
      invalid(`${named}: "year" must be a number, but it is ${describeValue(year)}`)
    }
    if (minutes !== undefined && typeof minutes !== 'number') {
      invalid(`${named}: "minutes" must be a number, but it is ${describeValue(minutes)}`)
    }
    if (group !== undefined && typeof group !== 'string') {
      invalid(`${named}: "group" must be text, but it is ${describeValue(group)}`)
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) invalid(`${named}: "tags" must be a list of text, but it is ${describeValue(tags)}`)
      const bad = tags.findIndex((tag) => typeof tag !== 'string')
      if (bad !== -1) invalid(`${named}: "tags" must be a list of text, but entry ${bad + 1} is ${describeValue(tags[bad])}`)
    }
    if (notes !== undefined && typeof notes !== 'string') {
      invalid(`${named}: "notes" must be text, but it is ${describeValue(notes)}`)
    }

    const trimmedNotes = typeof notes === 'string' ? notes.trim() : undefined
    if (trimmedNotes !== undefined && trimmedNotes.length > ITEM_NOTES_MAX_LENGTH) {
      fail('list.fileItemNotesTooLong', { index: index + 1, max: ITEM_NOTES_MAX_LENGTH })
    }

    // The same rules wherever a row is made (`itemFromFile`); here a bad file is refused whole, naming the item and the field.
    // A title or group written as a YAML block ends in a line break; that is dropped (and nothing else: a title with spaces at
    // either end survives an export and an import, exportList.test.ts), so it is not mistaken for a hazard.
    const cleanTitle = itemTitle.replace(/[\r\n]+$/, '')
    const cleanGroup = group?.replace(/[\r\n]+$/, '')
    checkText(`${named}: "title"`, cleanTitle, { max: NAME_MAX_LENGTH })
    if (year !== undefined && validYear(year) === undefined) {
      invalid(`${named}: "year" must be a whole number from ${YEAR_RANGE[0]} to ${YEAR_RANGE[1]}, but it is ${describeValue(year)}`)
    }
    if (minutes !== undefined && validMinutes(minutes) === undefined) {
      invalid(`${named}: "minutes" must be a whole number from ${MINUTES_RANGE[0]} to ${MINUTES_RANGE[1]}, but it is ${describeValue(minutes)}`)
    }
    if (cleanGroup !== undefined) checkText(`${named}: "group"`, cleanGroup, { max: NAME_MAX_LENGTH })
    if (tags !== undefined) {
      if (tags.length > TAGS_MAX) invalid(`${named}: "tags" has more than ${TAGS_MAX} entries`)
      ;(tags as string[]).forEach((tag, tagIndex) => checkText(`${named}: "tags" entry ${tagIndex + 1}`, tag, { max: TAG_MAX_LENGTH }))
    }
    if (trimmedNotes !== undefined) checkText(`${named}: "notes"`, trimmedNotes, { multiline: true })

    return {
      title: cleanTitle,
      ...(year !== undefined ? { year } : {}),
      ...(minutes !== undefined ? { minutes } : {}),
      ...(cleanGroup !== undefined ? { group: cleanGroup } : {}),
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
const CANONICAL_REPO_OWNER = 'gerharar'
const CANONICAL_REPO_NAME = 'listulator'
const CANONICAL_REPO_BRANCH = 'main'

/** The address a path would have, unchecked: `isSafeCanonicalPath` compares what the URL parser makes of it. */
function rawUrlOf(path: string): string {
  return `https://raw.githubusercontent.com/${CANONICAL_REPO_OWNER}/${CANONICAL_REPO_NAME}/${CANONICAL_REPO_BRANCH}/${path}`
}

/**
 * The one place a request address to the canonical repository is made, and it checks the path itself (security
 * review SR-053): the guard used to be applied by each caller, so a new caller that forgot it would have let a
 * list's `externalRef` pick a path the URL parser rewrites into another repository. Callers still check first
 * where they want to reply with their own error; this makes the check impossible to forget.
 */
function canonicalRawUrl(path: string): string {
  if (!isSafeCanonicalPath(path)) throw new CustomListParseError('list.fileInvalid')

  return rawUrlOf(path)
}

/**
 * Rejects anything that isn't a plain, relative path inside the repo. The path
 * comes from a list's `externalRef`, which any caller can set, and is not
 * checked against the manifest, so this is the whole guard: `raw.githubusercontent.com/.../main/`
 * + a path containing `..` normalizes to a different repo entirely, which would
 * defeat the "hardcoded to the canonical repo, never configurable" trust boundary.
 *
 * `%`, `?` and `#` are refused outright (no list file name has one): `fetch`'s URL
 * parser reads `%2e%2e` as `..`, so checking the segments as written was not
 * enough (review 2026-10-04). And the URL actually requested must be the path
 * as written, nothing normalized away.
 */
export function isSafeCanonicalPath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || /[\\:%?#]/.test(path)) return false
  if (!path.split('/').every((segment) => segment !== '..' && segment !== '.')) return false

  return new URL(rawUrlOf(path)).pathname === `/${CANONICAL_REPO_OWNER}/${CANONICAL_REPO_NAME}/${CANONICAL_REPO_BRANCH}/${path}`
}

export interface CanonicalListEntry {
  path: string
  title: string
  category: string
  /** A longer free-text blurb, mirrored from the list file's own `description`. Absent if unset. */
  description?: string
  /** Production status of the thing the list is about, mirrored from the file's own `status`. Absent if unset. */
  status?: 'complete' | 'ongoing'
  /** How many items the list file holds, so a picker can say so without fetching it. Absent in an older index. */
  itemCount?: number
}

/**
 * What a fetch from the library may bring (security review, Phase 19, SR-020): the library is read from the head of `main` and
 * shown as it arrives. The committed library is far inside these (a manifest of 17 KB with 64 entries; the largest list is 45
 * KB), so they stop a stolen branch or a mistake from feeding every installed app something huge, not a growing library.
 */
export const LIBRARY_FILE_MAX_BYTES = 1024 * 1024
export const LIBRARY_MANIFEST_MAX_BYTES = 512 * 1024
export const LIBRARY_MANIFEST_MAX_ENTRIES = 2000
const MANIFEST_PATH_MAX_LENGTH = 200
const MANIFEST_CATEGORY_MAX_LENGTH = 64

/** Text from the manifest that a picker will show: within its length and free of what disguises or breaks text. */
function isShownText(value: unknown, max: number, multiline = false): value is string {
  return typeof value === 'string' && value.length <= max && textHazard(value, multiline) === undefined
}

function isCanonicalListEntry(value: unknown): value is CanonicalListEntry {
  return (
    isPlainObject(value) &&
    typeof value['path'] === 'string' &&
    value['path'].length <= MANIFEST_PATH_MAX_LENGTH &&
    isShownText(value['title'], NAME_MAX_LENGTH) &&
    isShownText(value['category'], MANIFEST_CATEGORY_MAX_LENGTH) &&
    isSafeCanonicalPath(value['path']) &&
    // Both optional, so a manifest generated before this field existed still
    // validates — an older index.json simply omits them.
    (value['description'] === undefined || isShownText(value['description'], DESCRIPTION_MAX_LENGTH, true)) &&
    (value['status'] === undefined || value['status'] === 'complete' || value['status'] === 'ongoing') &&
    (value['itemCount'] === undefined ||
      (typeof value['itemCount'] === 'number' &&
        Number.isInteger(value['itemCount']) &&
        value['itemCount'] >= 0 &&
        value['itemCount'] <= MAX_LIST_ITEMS))
  )
}

/** Fetches and validates `lists/index.json` from the canonical repo. */
export async function fetchCanonicalManifest(fetchImpl?: FetchLike): Promise<CanonicalListEntry[]> {
  const manifest = await getJson<unknown>(canonicalRawUrl('lists/index.json'), {
    source: 'the canonical list repository',
    maxBytes: LIBRARY_MANIFEST_MAX_BYTES,
    ...(fetchImpl ? { fetchImpl } : {}),
  })

  if (!Array.isArray(manifest) || manifest.length > LIBRARY_MANIFEST_MAX_ENTRIES || !manifest.every(isCanonicalListEntry)) {
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
    maxBytes: LIBRARY_FILE_MAX_BYTES,
    ...(fetchImpl ? { fetchImpl } : {}),
  })

  return parseCustomList(text, validCategories)
}

/** One community-library match, in the shape a search result takes. */
export interface CanonicalSearchResult {
  externalRef: string
  title: string
  detail: string
  description?: string
  status?: 'complete' | 'ongoing'
  /** How many items the list file holds, from the manifest; absent in an older index. */
  itemCount?: number
}

/**
 * Searches the community library, and says whether it could be reached at all.
 *
 * An unreachable library (offline, a private or missing repo, GitHub down) is
 * not the same as "no curated list matches", and callers have to tell them
 * apart: with no API key either, the user is told the library is down rather
 * than that a key is missing; with one, they are told curated lists were not
 * searched. Any upstream failure counts as unreachable; anything else is a bug
 * and still throws.
 */
export async function searchLibrary(
  category: string,
  query: string,
  fetchImpl?: FetchLike,
): Promise<{ matches: CanonicalSearchResult[]; reachable: boolean }> {
  let manifest: CanonicalListEntry[]
  try {
    manifest = await fetchCanonicalManifest(fetchImpl)
  } catch (error) {
    if (error instanceof IngestionError) return { matches: [], reachable: false }
    throw error
  }

  const normalizedQuery = query.trim().toLowerCase()

  const matches = manifest
    .filter(
      (entry) => entry.category === category && entry.title.toLowerCase().includes(normalizedQuery),
    )
    .map((entry) => ({
      externalRef: canonicalExternalRef(entry.path),
      title: entry.title,
      detail: 'Canonical list',
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
      ...(entry.itemCount !== undefined ? { itemCount: entry.itemCount } : {}),
    }))

  return { matches, reachable: true }
}

/** As `searchLibrary`, for callers that only want the matches. */
export async function searchCanonicalLists(
  category: string,
  query: string,
  fetchImpl?: FetchLike,
): Promise<CanonicalSearchResult[]> {
  return (await searchLibrary(category, query, fetchImpl)).matches
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

/** A library list the reader does not track, in the shape the Surprise Me picker reads. */
export interface LibraryEntry {
  externalRef: string
  title: string
  category: string
  description?: string
  status?: 'complete' | 'ongoing'
  itemCount?: number
}

/**
 * The community-library lists a reader could add and does not have yet: a
 * category the app knows (an entry it cannot add is never offered), and a
 * `canonical:` ref none of their lists carries. Tracking is by ref, not title,
 * so renaming a synced list does not bring it back.
 */
export function untrackedLibraryEntries(
  manifest: readonly CanonicalListEntry[],
  trackedRefs: ReadonlySet<string>,
  validCategories: ReadonlySet<string>,
): LibraryEntry[] {
  return manifest
    .filter((entry) => validCategories.has(entry.category) && !trackedRefs.has(canonicalExternalRef(entry.path)))
    .map((entry) => ({
      externalRef: canonicalExternalRef(entry.path),
      title: entry.title,
      category: entry.category,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      ...(entry.status !== undefined ? { status: entry.status } : {}),
      ...(entry.itemCount !== undefined ? { itemCount: entry.itemCount } : {}),
    }))
}

