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
