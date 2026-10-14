import type { ListItem } from '../../lib/api.js'
import { parseYearText } from '../../../../server/src/catalog/years.js'
import { parseMinutes } from './AddItemForm.js'

/** What the edit popover holds while it is open, as typed. */
export interface EditDraft {
  title: string
  minutes: string
  group: string
  /** The year field as typed (H-004, H-005): empty clears the year; absent leaves it alone. */
  year?: string
  /** The tags to save, only when the tag field changed them (U5); absent leaves the stored tags alone. */
  tags?: string[]
}

export interface ItemPatch {
  title?: string
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
  group?: string | null
  /** The year, or the earliest it can be; null clears it. Always sent with `yearUnk` (H-004, H-005). */
  year?: number | null
  /** How many of `year`'s last digits are unknown: 0, 1 or 2. */
  yearUnk?: number
  /** The item's whole tag list (U5); null clears it. */
  tags?: string[] | null
}

/**
 * What saving the draft would change — only the fields that differ, or `null`
 * when nothing does *or* the draft cannot be saved (a blank title, minutes
 * that are not a whole number, a year that is not one). A minutes value you typed is no longer an
 * estimate; an unchanged one keeps whatever flag it had.
 */
export function buildEditPatch(item: ListItem, draft: EditDraft): ItemPatch | null {
  const title = draft.title.trim()
  const minutes = parseMinutes(draft.minutes)
  if (title === '' || minutes === null || Number.isNaN(minutes)) return null

  const group = draft.group.trim() === '' ? null : draft.group.trim()
  const year = draft.year === undefined ? undefined : parseYearText(draft.year)
  if (draft.year !== undefined && year === undefined) return null
  const patch: ItemPatch = {}

  if (title !== item.title) patch.title = title
  if (minutes !== item.timeToConsumeMinutes) {
    patch.timeToConsumeMinutes = minutes
    patch.timeToConsumeIsEstimated = false
  }
  if (group !== (item.group || null)) patch.group = group
  // The year and its unknown digits go together: 1990 and 199? are different years.
  if (year && (year.year !== item.year || year.yearUnk !== item.yearUnk)) {
    patch.year = year.year
    patch.yearUnk = year.yearUnk
  }
  if (draft.tags !== undefined) patch.tags = draft.tags.length > 0 ? draft.tags : null

  return Object.keys(patch).length > 0 ? patch : null
}

/** The patch that undoes `patch` on `item`: each changed field back to what it was. */
export function invertPatch(item: ListItem, patch: ItemPatch): ItemPatch {
  const back: ItemPatch = {}

  if (patch.title !== undefined) back.title = item.title
  if (patch.timeToConsumeMinutes !== undefined) {
    back.timeToConsumeMinutes = item.timeToConsumeMinutes
    back.timeToConsumeIsEstimated = item.timeToConsumeIsEstimated
  }
  if (patch.group !== undefined) back.group = item.group || null
  if (patch.year !== undefined) {
    back.year = item.year
    back.yearUnk = item.yearUnk
  }
  if (patch.tags !== undefined) back.tags = item.tags && item.tags.length > 0 ? [...item.tags] : null

  return back
}
