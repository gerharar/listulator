import { MINUTES_RANGE } from './limits.js'

/**
 * What a person types for an item's length (H-007): minutes (`95`), hours and minutes (`1h 35m`, `1h35m`, `1h`, `45m`,
 * `45 min`) or a clock (`1:35`, the minutes after the colon 00 to 59), in either case. It is kept as whole minutes; the row
 * shows the usual `1h 35m`. The words form takes any number of minutes (`1h 61m` is 121), only the clock form limits them.
 * Empty is no length typed: the category's default applies (owner, 2026-10-15). One module for the desktop and the screens,
 * as `years.ts` is for the year.
 */

export type DurationProblem = 'form' | 'zero' | 'range'

/** `1h 35m`, `1h`, `45m`, `45 min`: hours and minutes each optional, at least one, in that order. */
const WORDS = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:m|min))?$/i
/** `1:35`: hours, then exactly two digits of minutes. */
const CLOCK = /^(\d+):(\d{2})$/

/** The minutes the text says, or a problem; null when it says nothing (empty). A number over any bound is still a number. */
function read(text: string): number | DurationProblem | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  let minutes: number
  const clock = CLOCK.exec(trimmed)
  if (clock) {
    if (Number(clock[2]) > 59) return 'form'
    minutes = Number(clock[1]) * 60 + Number(clock[2])
  } else if (/^\d+$/.test(trimmed)) {
    minutes = Number(trimmed)
  } else {
    const words = WORDS.exec(trimmed)
    // The pattern also matches nothing at all, which is not a length; `trimmed` is not empty, so that cannot be here.
    if (!words || (words[1] === undefined && words[2] === undefined)) return 'form'
    minutes = Number(words[1] ?? 0) * 60 + Number(words[2] ?? 0)
  }

  if (minutes < MINUTES_RANGE[0]) return 'zero'
  if (minutes > MINUTES_RANGE[1]) return 'range'

  return minutes
}

/**
 * The field's text as whole minutes: a length it reads, `null` for empty (the category's default applies), and `undefined`
 * when it is not a length (`abc`, `1.5h`, `1:61`, `0`, `100000`): the field is wrong.
 */
export function parseDurationText(text: string): number | null | undefined {
  const found = read(text)

  return typeof found === 'string' ? undefined : found
}

/**
 * Why the field's text is not a length, or null when it is (or is empty): `zero` for a length of nothing, `range` for one
 * over the most the app holds, `form` for text that is neither. The screens word the three apart.
 */
export function durationTextProblem(text: string): DurationProblem | null {
  const found = read(text)

  return typeof found === 'string' ? found : null
}
