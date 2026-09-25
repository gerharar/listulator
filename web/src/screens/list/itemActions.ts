import type { ListItem } from '../../lib/api.js'
import { parseMinutes } from './AddItemForm.js'

/** What the edit popover holds while it is open, as typed. */
export interface EditDraft {
  title: string
  minutes: string
  group: string
}

export interface ItemPatch {
  title?: string
  timeToConsumeMinutes?: number
  timeToConsumeIsEstimated?: boolean
  group?: string | null
}

/**
 * What saving the draft would change — only the fields that differ, or `null`
 * when nothing does *or* the draft cannot be saved (a blank title, minutes
 * that are not a whole number). A minutes value you typed is no longer an
 * estimate; an unchanged one keeps whatever flag it had.
 */
export function buildEditPatch(item: ListItem, draft: EditDraft): ItemPatch | null {
  const title = draft.title.trim()
  const minutes = parseMinutes(draft.minutes)
  if (title === '' || minutes === null || Number.isNaN(minutes)) return null

  const group = draft.group.trim() === '' ? null : draft.group.trim()
  const patch: ItemPatch = {}

  if (title !== item.title) patch.title = title
  if (minutes !== item.timeToConsumeMinutes) {
    patch.timeToConsumeMinutes = minutes
    patch.timeToConsumeIsEstimated = false
  }
  if (group !== (item.group || null)) patch.group = group

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

  return back
}
