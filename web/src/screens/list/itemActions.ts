import type { ListItem } from '../../lib/api.js'
import type { Locale } from '../../locale/index.js'
import { durationTextProblem, parseDurationText, type DurationProblem } from '../../../../server/src/catalog/durations.js'
import { formatYear, parseYearText, yearTextProblem } from '../../../../server/src/catalog/years.js'
import { normalizeUserNote, USER_NOTE_MAX_LENGTH } from '../../../../server/src/catalog/userNotes.js'

/** What the edit popover holds while it is open, as typed. */
export interface EditDraft {
  title: string
  minutes: string
  group: string
  /** The year field as typed (H-004, H-005): empty clears the year; absent leaves it alone. */
  year?: string
  /** The tags to save, only when the tag field changed them (U5); absent leaves the stored tags alone. */
  tags?: string[]
  /** The Note field as typed (H-003): empty or spaces removes the note; absent leaves it alone. */
  note?: string
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
  /** The user's own note (H-003); null removes it. */
  userNote?: string | null
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
 * What the Duration field holds when the window opens (owner, 2026-10-15): the number for a length that was given, and
 * nothing for an estimate, since an empty field means the category's default, which is what an estimate is. The field is
 * checked and saved only when it no longer reads this.
 */
export function durationFieldText(item: Pick<ListItem, 'timeToConsumeMinutes' | 'timeToConsumeIsEstimated'>): string {
  return item.timeToConsumeIsEstimated ? '' : String(item.timeToConsumeMinutes)
}

export const titleProblem = (text: string): 'empty' | null => (text.trim() === '' ? 'empty' : null)

/** What is wrong with the Duration text; a length the person did not change is never checked (a stored 0 stays editable). */
export function minutesProblem(item: ListItem, text: string): DurationProblem | null {
  return text.trim() === durationFieldText(item) ? null : durationTextProblem(text)
}

/** What is wrong with the Year text; a year the person did not change is never checked (a stored 800 stays editable). */
export function yearProblem(item: ListItem, text: string): EditProblems['year'] {
  return text.trim() === formatYear(item) ? null : yearTextProblem(text)
}

/**
 * What is wrong with the draft, for the window to say (H-006). A length or a year the person did not change is never
 * checked, so a value stored from before (a year below 1000, a length of 0) cannot stop another edit from being saved.
 */
export function editProblems(item: ListItem, draft: EditDraft): EditProblems {
  return {
    title: titleProblem(draft.title),
    minutes: minutesProblem(item, draft.minutes),
    year: draft.year === undefined ? null : yearProblem(item, draft.year),
  }
}

type ItemActionsText = Locale['quantum']['list']['itemActions']

/** The sentence for a year problem (`editProblems`, `yearTextProblem`); a year too far ahead repeats what was typed. */
export function yearSentence(text: ItemActionsText, problem: 'form' | 'early' | 'late', typed: string): string {
  if (problem === 'form') return text.yearForm

  return problem === 'early' ? text.yearTooEarly : text.yearTooLate(typed.trim())
}

/** The sentence for a duration problem; a length of nothing names the category's default, which an empty field means. */
export function minutesSentence(text: ItemActionsText, problem: DurationProblem, defaultMinutes: number): string {
  if (problem === 'form') return text.minutesForm

  return problem === 'zero' ? text.minutesZero(defaultMinutes) : text.minutesRange
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
  if (draft.minutes.trim() !== durationFieldText(item)) {
    const typed = parseDurationText(draft.minutes)
    if (typed === null) {
      // A length that was given, cleared: the category's default again, as an estimate.
      patch.timeToConsumeMinutes = defaultMinutes
      patch.timeToConsumeIsEstimated = true
    } else if (typed !== undefined) {
      // A length typed is the person's own, even over an estimate with the same number; the same number as a given length
      // written another way (1h 30m for 90) changes nothing.
      if (typed !== item.timeToConsumeMinutes) patch.timeToConsumeMinutes = typed
      if (typed !== item.timeToConsumeMinutes || item.timeToConsumeIsEstimated) patch.timeToConsumeIsEstimated = false
    }
  }
  if (group !== (item.group || null)) patch.group = group
  // The year and its unknown digits go together: 1990 and 199? are different years.
  if (year && (year.year !== item.year || year.yearUnk !== item.yearUnk)) {
    patch.year = year.year
    patch.yearUnk = year.yearUnk
  }
  if (draft.tags !== undefined) patch.tags = draft.tags.length > 0 ? draft.tags : null
  if (draft.note !== undefined) {
    // As stored (trimmed, line breaks made newlines): a note written another way that is the same note changes nothing.
    // The field stops at the limit, so the cut is only for a paste that got round it.
    const note = normalizeUserNote(draft.note.slice(0, USER_NOTE_MAX_LENGTH))
    if (note !== (item.userNote ?? null)) patch.userNote = note
  }

  return Object.keys(patch).length > 0 ? patch : null
}

/** The patch that undoes `patch` on `item`: each changed field back to what it was. */
export function invertPatch(item: ListItem, patch: ItemPatch): ItemPatch {
  const back: ItemPatch = {}

  if (patch.title !== undefined) back.title = item.title
  // The length and whether it was an estimate go back together; the flag can also change alone (a typed length with
  // the estimate's own number).
  if (patch.timeToConsumeMinutes !== undefined) back.timeToConsumeMinutes = item.timeToConsumeMinutes
  if (patch.timeToConsumeMinutes !== undefined || patch.timeToConsumeIsEstimated !== undefined) {
    back.timeToConsumeIsEstimated = item.timeToConsumeIsEstimated
  }
  if (patch.group !== undefined) back.group = item.group || null
  if (patch.year !== undefined) {
    back.year = item.year
    back.yearUnk = item.yearUnk
  }
  if (patch.tags !== undefined) back.tags = item.tags && item.tags.length > 0 ? [...item.tags] : null
  if (patch.userNote !== undefined) back.userNote = item.userNote ?? null

  return back
}
