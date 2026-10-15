import type { ListItem } from '../../lib/api.js'
import { formatDuration } from '../../formatDuration.js'

/** What marks a length the category guessed rather than one the source or the person gave. */
const ESTIMATE_MARK = '≈'

type Length = Pick<ListItem, 'timeToConsumeMinutes' | 'timeToConsumeIsEstimated' | 'runtimePending'>

/**
 * A row's length as it is written (owner, 2026-10-14): `51m`, `≈51m` when the length is the category's guess, and the
 * pending mark while it is still being looked up (15.7), with no ≈ since there is no guess to speak of yet.
 */
export function lengthLabel(item: Length, pendingMark: string): string {
  if (item.runtimePending) return pendingMark

  return `${item.timeToConsumeIsEstimated ? ESTIMATE_MARK : ''}${formatDuration(item.timeToConsumeMinutes)}`
}

/** The minutes column, in characters: the widest label of the list, one more so the numbers stay apart, four at least. */
export function minutesColumnWidth(items: readonly Length[], pendingMark: string): number {
  return Math.max(4, ...items.map((item) => lengthLabel(item, pendingMark).length)) + 1
}
