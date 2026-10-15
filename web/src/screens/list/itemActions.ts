import type { ListItem } from '../../lib/api.js'
import { durationTextProblem, parseDurationText, type DurationProblem } from '../../../../server/src/catalog/durations.js'
import { parseYearText, yearFieldText, yearTextProblem } from '../../../../server/src/catalog/years.js'

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

export interface EditProblems {
  /** An item needs a title. */
  title: 'empty' | null
  /** The Duration field's text is not a length (H-007); an empty one is not wrong, it means the category default. */
  minutes: DurationProblem | null
  /** The Year field's text is not a year in the years the app holds (H-004, H-005); null when the draft carries none. */
  year: 'form' | 'early' | 'late' | null
}

/**
 * What is wrong with the draft, for the window to say (H-006). A length or a year the person did not change is never
 * checked, so a value stored from before (a year below 1000, a length of 0) cannot stop another edit from being saved.
 */
export function editProblems(item: ListItem, draft: EditDraft): EditProblems {
  const minutesChanged = draft.minutes.trim() !== String(item.timeToConsumeMinutes)
  const yearChanged = draft.year !== undefined && draft.year.trim() !== yearFieldText(item)

  return {
    title: draft.title.trim() === '' ? 'empty' : null,
    minutes: minutesChanged ? durationTextProblem(draft.minutes) : null,
    year: yearChanged ? yearTextProblem(draft.year!) : null,
  }
}

/**
 * What saving the draft would change: only the fields that differ, or `null` when nothing does or the draft cannot be
 * saved (`editProblems` says why). An empty duration is the category's default, marked as an estimate (owner, 2026-10-15);
 * a length you typed is no longer an estimate, and an unchanged one keeps whatever flag it had.
 */
export function buildEditPatch(item: ListItem, draft: EditDraft, defaultMinutes: number): ItemPatch | null {
  const problems = editProblems(item, draft)
  if (problems.title || problems.minutes || problems.year) return null

  const title = draft.title.trim()
  const group = draft.group.trim() === '' ? null : draft.group.trim()
  const year = draft.year === undefined ? undefined : parseYearText(draft.year)
  const patch: ItemPatch = {}

  if (title !== item.title) patch.title = title
  if (draft.minutes.trim() !== String(item.timeToConsumeMinutes)) {
    const typed = parseDurationText(draft.minutes)
    if (typed === null) {
      if (item.timeToConsumeMinutes !== defaultMinutes || !item.timeToConsumeIsEstimated) {
        patch.timeToConsumeMinutes = defaultMinutes
        patch.timeToConsumeIsEstimated = true
      }
    } else if (typed !== undefined && typed !== item.timeToConsumeMinutes) {
      patch.timeToConsumeMinutes = typed
      patch.timeToConsumeIsEstimated = false
    }
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
