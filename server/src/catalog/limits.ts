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

