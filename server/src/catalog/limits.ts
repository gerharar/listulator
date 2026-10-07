/**
 * The longest a name people type may be: a list's title, an item's title, a group's name (owner,
 * 2026-09-30). One number for the server's request schemas, the web inputs' `maxLength` and the
 * desktop backend's own check, so they cannot drift apart.
 *
 * Deliberately not applied to what a source names (a TMDB title on Add list, items a refresh
 * brings in) or to restoring something that already exists (Undo): those were never typed here,
 * and an over-long one already in a database must still come back.
 */
export const NAME_MAX_LENGTH = 255

/**
 * The most items one list can be built with (task 15.9, owner: built lists are uncapped, but not without
 * end). A source above it is refused with a sentence naming the source and how many items it has, in the
 * count, the Preview and Add list alike, and never cut short without a word. Ten thousand is where one
 * list stops being a thing a person can finish and where TMDB's own discover paging ends (500 pages of 20).
 */
export const MAX_LIST_ITEMS = 10_000


/**
 * What an item's length may be, in minutes: a whole number from one minute to about 69 days (security review, Phase 19,
 * SR-019). A list file or a connector that says `.inf`, `.nan`, a negative number or `1e308` otherwise corrupts the totals,
 * the "time remaining" sentence and, for `.nan`, ends in a database error.
 */
export const MINUTES_RANGE = [1, 100_000] as const

/**
 * What an item's year may be: a whole number from 1 to 3000 (the owner's choice, 2026-10-07). Wide on purpose (Don Quixote is
 * 1605, a film can be set in the future): this stops nonsense (`1e308`, `.nan`, a negative number), not an unusual year. The
 * committed library is held to the narrower 1800 to 2100 by its own guard test.
 */
export const YEAR_RANGE = [1, 3000] as const

/** A list's own blurb. The library's guard test has held committed lists to this since 19.4; the parser now holds every file. */
export const DESCRIPTION_MAX_LENGTH = 1_000

/** Tags on one item, and the length of one tag (the same). */
export const TAGS_MAX = 20
export const TAG_MAX_LENGTH = 64

/**
 * The most text a list file may be, as read: the largest committed list is 45 KB and a list of `MAX_LIST_ITEMS` items with
 * a line or two each is about a megabyte. A file over this is refused before it is parsed (a desktop import had no limit).
 */
export const LIST_FILE_MAX_CHARS = 4 * 1024 * 1024

const wholeWithin = (value: unknown, [min, max]: readonly [number, number]): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined

/** The length if it is one the app can show, else `undefined` (unknown: the row falls back to an estimate). */
export function validMinutes(value: unknown): number | undefined {
  return wholeWithin(value, MINUTES_RANGE)
}

/** The year if it is one the app can show, else `undefined` (the row has no year). */
export function validYear(value: unknown): number | undefined {
  return wholeWithin(value, YEAR_RANGE)
}
