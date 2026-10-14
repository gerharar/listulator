import { validYear } from './limits.js'

/**
 * An item's year (H-004, H-005): four digits, or four with the last one or two unknown (`199?`, `19??`).
 *
 * Stored as `year` = the earliest it can be (`199?` is 1990) and `yearUnk` = how many digits are unknown (0, 1 or 2), so
 * code that ignores `yearUnk` still sees a sane year and sorting stays numeric. The text is never stored. One module for
 * the server, the desktop and the screens, so the rules cannot drift between the field, the sort and a list file.
 */

export type YearUnknown = 0 | 1 | 2

/** A year and its unknown digits that do not fit together (see `validYearPair`): the API says 400, `item.invalidYear`. */
export class InvalidYearError extends Error {
  constructor() {
    super('invalid year')
    this.name = 'InvalidYearError'
  }
}

export interface ItemYear {
  /** The earliest year it can be; null: the item has no year (then `yearUnk` is 0). */
  year: number | null
  yearUnk: YearUnknown
}

export const NO_YEAR: ItemYear = { year: null, yearUnk: 0 }

/** What a database row or an API item holds: the same two numbers, typed as the column is. */
export interface YearLike {
  year: number | null
  yearUnk: number
}

/** The three forms, exactly: `1994`, `199?`, `19??`. `?` only at the end, one or two of them. */
const FORM = /^(\d{4}|\d{3}\?|\d{2}\?\?)$/

const unknownDigits = (text: string): YearUnknown => (text.length - text.replace(/\?/g, '').length) as YearUnknown

/**
 * What a keystroke may leave in the year field: digits, then `?`, four characters at most. Anything else typed is dropped,
 * so `1?9x` becomes `1?`; whether what is left is a year is `parseYearText`'s question.
 */
export function filterYearInput(typed: string): string {
  const kept = /^(\d*)(\?*)/.exec(typed.replace(/[^\d?]/g, ''))

  return `${kept?.[1] ?? ''}${kept?.[2] ?? ''}`.slice(0, 4)
}

/**
 * A year and its unknown digits, as an API or a file hands them over, or `undefined` when they do not fit: the year must be
 * within what the app holds (`YEAR_RANGE`), `yearUnk` 0, 1 or 2 (a missing one is 0), no unknown digits without a year, and
 * the year a multiple of ten to the power of the unknown digits (1990 with one, 1900 with two), so a row can never say
 * `1994` and `19?4`.
 */
export function validYearPair(year: unknown, yearUnk: unknown): ItemYear | undefined {
  const unknown = yearUnk ?? 0
  if (unknown !== 0 && unknown !== 1 && unknown !== 2) return undefined

  if (year === null || year === undefined) return unknown === 0 ? NO_YEAR : undefined

  const valid = validYear(year)
  if (valid === undefined || valid % 10 ** unknown !== 0) return undefined

  return { year: valid, yearUnk: unknown }
}

/**
 * The year field's text as an item year: empty is "no year" (valid), one of the three forms within the years the app holds
 * is a year, and anything else, including `3500` and `0000`, is `undefined` (the field is wrong).
 */
export function parseYearText(text: string): ItemYear | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return NO_YEAR
  if (!FORM.test(trimmed)) return undefined

  return validYearPair(Number.parseInt(trimmed.replace(/\?/g, '0'), 10), unknownDigits(trimmed))
}

/**
 * Why the field's text is not a year, or null when it is (or is empty): `form` for text that is not one of the three forms,
 * `range` for a year of the right form outside the years the app holds (`3500`, `0000`). The screens word the two apart.
 */
export function yearTextProblem(text: string): 'form' | 'range' | null {
  if (parseYearText(text) !== undefined) return null

  return FORM.test(text.trim()) ? 'range' : 'form'
}

/** A year as a row and a header show it: `1994`, `199?`, `19??`; nothing for none. A year below 1000 has no zero here. */
export function formatYear(value: YearLike): string {
  if (value.year === null) return ''
  if (value.yearUnk === 0) return String(value.year)

  return `${String(value.year).padStart(4, '0').slice(0, 4 - value.yearUnk)}${'?'.repeat(value.yearUnk)}`
}

/** A year as the field holds it: four characters, so what `parseYearText` reads back is the same year (`0800`). */
export function yearFieldText(value: YearLike): string {
  if (value.year === null) return ''

  return value.yearUnk === 0 ? String(value.year).padStart(4, '0') : formatYear(value)
}

/**
 * Where an item sorts by release date: the latest year it can be, a narrower guess before a wider one ending the same year,
 * so `1989 < 198? < 1990 < 1999 < 199? < 19?? < 2000`. No year sorts after every year.
 */
export function yearSortKey(value: YearLike): number {
  if (value.year === null) return Number.POSITIVE_INFINITY

  return value.year + 10 ** value.yearUnk - 1 + value.yearUnk / 10
}

/** The ends of a group's years, by the same key as the sort, or null when none of its items has a year. */
export function yearSpan<T extends YearLike>(items: readonly T[]): { from: T; to: T } | null {
  const dated = items.filter((item) => item.year !== null).sort((a, b) => yearSortKey(a) - yearSortKey(b))
  const from = dated[0]
  const to = dated[dated.length - 1]

  return from && to ? { from, to } : null
}

/** `1990s` for `199?`, `1900s` for `19??`: what a tooltip names; null for an exact year or none. */
export function approximateDecade(value: YearLike): string | null {
  return value.year !== null && value.yearUnk > 0 ? `${value.year}s` : null
}

/**
 * Use Hands: a year in brackets at the very end of a line is the item's year (`Fast Five (2011)`), and a bracket anywhere
 * else stays in the title (`Spider-Man (1990) #57`). Null when the line has none, when nothing is left for a title, or
 * when the year is outside what the app holds (owner, 2026-10-14: `Foo (0000)` stays as typed).
 */
export function splitTrailingYear(line: string): { title: string; year: ItemYear } | null {
  const found = /^(.*\S)\s*\((\d{4}|\d{3}\?|\d{2}\?\?)\)$/.exec(line)
  const year = found ? parseYearText(found[2]!) : undefined

  return found && year ? { title: found[1]!, year } : null
}

/**
 * A list file's year (H-005): a whole number, or one of the three forms as text (`"199?"`, `"19??"`, and an exact year in
 * quotes, owner 2026-10-14), within the years the app holds. Anything else, including text with spaces around it, is
 * `undefined`: the caller refuses the file with its usual sentence.
 */
export function parseYamlYear(value: unknown): ItemYear | undefined {
  if (typeof value === 'number') return validYearPair(value, 0)
  if (typeof value === 'string' && FORM.test(value)) return parseYearText(value)

  return undefined
}

/** What a list file shows for an item's year: an exact year as a number, a partial one as the quoted text. */
export function yamlYearValue(value: YearLike): number | string | undefined {
  if (value.year === null) return undefined

  return value.yearUnk === 0 ? value.year : formatYear(value)
}
