import { dump } from 'js-yaml'
import type { MediaListDetail } from './api.js'

/**
 * A list as the shipped YAML file (C5, `docs/intent/custom-lists.md`): the
 * same format Import reads, so an export can be imported back. One
 * implementation for both backends, since it only needs what the list screen
 * already loaded.
 *
 * What goes out is what the format can say: title, description, category (the
 * registry key), status, and each item's title, year, minutes, group, tags and
 * notes, in the list's own order. A runtime that is only an estimate is left
 * out, so it is still an estimate after the round trip. Done marks, NEW
 * markers and ids are the reader's own state, not part of a list, and stay
 * behind; so does whether an item was added by hand, and a group with no
 * items (the format names groups only through their items).
 */
export function exportList(list: MediaListDetail): string {
  const items = [...list.items]
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id))
    .map((item) => ({
      title: item.title,
      ...(item.year !== null ? { year: item.year } : {}),
      ...(item.timeToConsumeIsEstimated ? {} : { minutes: item.timeToConsumeMinutes }),
      ...(item.group ? { group: item.group } : {}),
      ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
    }))

  return dump(
    {
      title: list.title,
      ...(list.description ? { description: list.description } : {}),
      category: list.mediaType,
      ...(list.status ? { status: list.status } : {}),
      items,
    },
    // Items stay on one line each, the way the shipped lists are written.
    { flowLevel: 2, lineWidth: -1, noRefs: true },
  )
}

const MAX_NAME = 100

/** The title as a file name: nothing a file system objects to, and a fallback for a title with nothing left. */
export function exportFileName(title: string): string {
  const name = title
    .replace(/[^\p{L}\p{N} ._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim()

  return `${name || 'list'}.yaml`
}
