import type { PreviewItem, SourceOptions } from './api.js'

/** What identifies a source to preview or add: exactly what Add list sends. */
export interface PreviewSource {
  mediaType: string
  externalRef: string
  title: string
  options: SourceOptions
}

const PREVIEW_PATH = '/lists/preview'
const FLAGS = [
  'includeUnknown',
  'includeEp',
  'includeSingle',
  'includeLive',
  'includeCompilation',
] as const

/** The Preview layer's own path — a layer's content is a string (see `LayerStackContext`). */
export function previewPath({ mediaType, externalRef, title, options }: PreviewSource): string {
  const params = new URLSearchParams({ mediaType, externalRef, title })
  if (options.language) params.set('language', options.language)
  for (const key of FLAGS) {
    const value = options[key]
    if (value !== undefined) params.set(key, String(value))
  }

  return `${PREVIEW_PATH}?${params.toString()}`
}

export function parsePreviewPath(params: URLSearchParams): PreviewSource | null {
  const mediaType = params.get('mediaType')
  const externalRef = params.get('externalRef')
  if (!mediaType || !externalRef) return null

  const options: SourceOptions = {}
  const language = params.get('language')
  if (language) options.language = language
  for (const key of FLAGS) {
    const value = params.get(key)
    if (value !== null) options[key] = value === 'true'
  }

  return { mediaType, externalRef, title: params.get('title') ?? '', options }
}

/** The one place the Add-list request is built, so a row and a Preview cannot differ. */
export function createFromSourceInput(source: PreviewSource) {
  return {
    mediaType: source.mediaType,
    externalRef: source.externalRef,
    title: source.title,
    ...source.options,
  }
}

export interface PreviewSummary {
  count: number
  minutes: number
  /** Some runtimes are the category's default, not the source's own. */
  estimated: boolean
}

export function summarizePreview(
  items: readonly PreviewItem[],
  defaultMinutes: number,
): PreviewSummary {
  let minutes = 0
  let estimated = false

  for (const item of items) {
    if (item.timeToConsumeMinutes === undefined) estimated = true
    minutes += item.timeToConsumeMinutes ?? item.estimatedMinutes ?? defaultMinutes
  }

  return { count: items.length, minutes, estimated }
}

export type PreviewRowData =
  | { kind: 'group'; label: string; count: number }
  | { kind: 'item'; item: PreviewItem; grouped: boolean }

/**
 * The items in arrival order, with a group head each time the group changes.
 * A group that comes back later (a franchise interleaves films and episodes)
 * gets a new head: arrival order is what a Preview shows.
 */
export function groupPreviewRows(items: readonly PreviewItem[]): PreviewRowData[] {
  const rows: PreviewRowData[] = []
  let current: string | undefined
  let head: Extract<PreviewRowData, { kind: 'group' }> | undefined

  for (const item of items) {
    if (item.group !== current) {
      current = item.group
      head = current === undefined ? undefined : { kind: 'group', label: current, count: 0 }
      if (head) rows.push(head)
    }
    if (head) head.count += 1
    rows.push({ kind: 'item', item, grouped: current !== undefined })
  }

  return rows
}
