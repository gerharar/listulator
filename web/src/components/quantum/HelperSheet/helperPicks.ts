import { formatDuration } from '../../../formatDuration.js'
import type { SuggestionPick } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'

/** How a pick is named when a reroll turns it down: its list and the item it would start you on. */
export function pickKey(pick: SuggestionPick): string {
  return `${pick.list.id}|${pick.nextItem?.id ?? ''}`
}

/**
 * Not That: what has been turned down drops out and the rest move up. Once
 * everything has been turned down the rejections lapse and the strongest pick
 * is offered again, rather than dead-ending on an empty panel (prototype).
 */
export function reroll(
  picks: readonly SuggestionPick[],
  rejected: readonly string[],
): { shown: SuggestionPick[]; exhausted: boolean } {
  const live = picks.filter((pick) => !rejected.includes(pickKey(pick)))

  return live.length > 0 ? { shown: live, exhausted: false } : { shown: [...picks], exhausted: true }
}

/** A factor "made" the pick when it contributed at least half of what it could. */
const STANDS_OUT = 0.5

/**
 * I'm Tired, Boss's one-line why, from the engine's own factor contributions:
 * the medium always differs (the engine guarantees it); being neglected and
 * being far along are said only when they are what put this list on top.
 */
export function whyTired(pick: SuggestionPick): string {
  const text = copy.quantum.helper.tired
  const neglected = (pick.factors['neglect_time'] ?? 0) >= STANDS_OUT
  const along = (pick.factors['completion_percent'] ?? 0) >= STANDS_OUT

  if (!neglected && !along) return text.whyFallback

  const first = neglected ? `${text.whyBase}, ${text.whyNeglected}.` : `${text.whyBase}.`
  const { completionPercent, timeRemainingMinutes } = pick.list.stats

  return along
    ? `${first} ${text.whyProgress(Math.round(completionPercent), formatDuration(timeRemainingMinutes))}.`
    : first
}

/**
 * Finalizer's one-line why: how close the list is, then which band it sits in
 * when that is what decided it — a complete list stays finished; an ongoing one
 * on top means nothing finishable is closer.
 */
export function whyFinalizer(pick: SuggestionPick): string {
  const text = copy.quantum.helper.finalizer
  const { completionPercent, timeRemainingMinutes } = pick.list.stats
  const base = text.why(Math.round(completionPercent), formatDuration(timeRemainingMinutes))

  if (pick.list.status === 'complete') return `${base} ${text.whyComplete}`
  if (pick.list.status === 'ongoing') return `${base} ${text.whyOngoing}`

  return base
}

/** Just One Fix's one-line why: the item is the shortest one left anywhere, and how long it takes. */
export function whyJustOneFix(pick: SuggestionPick): string {
  return copy.quantum.helper.justOneFix.why(formatDuration(pick.nextItem?.timeToConsumeMinutes ?? 0))
}
