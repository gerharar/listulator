import { strippedOfHazards } from '../ingestion/textHazards.js'

/**
 * The user's own note on an item (H-003, BL-043; owner, 2026-10-15): text a person typed, kept in a field of its own
 * (`list_items.user_note`), never the curator's `notes` and never anything fetched from a source. One module for the
 * server, the desktop and the screens, as `years.ts` is for the year.
 */

/** The most a note may hold, as JavaScript counts: an emoji is two. The screen stops typing here; this is the backstop. */
export const USER_NOTE_MAX_LENGTH = 2048

/** A note over `USER_NOTE_MAX_LENGTH`: the API says 400, `item.noteTooLong`. */
export class InvalidNoteError extends Error {
  constructor() {
    super('invalid note')
    this.name = 'InvalidNoteError'
  }
}

/**
 * A note as it is stored: every line break a newline, controls and direction overrides taken out (a tab and the newlines
 * stay), the spaces and lines around it trimmed, and nothing left is no note (null). Refused over the limit, counted after
 * all that, so a note pasted from Windows is the same note.
 */
export function normalizeUserNote(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null

  const note = strippedOfHazards(text.replace(/\r\n?/g, '\n'), true).trim()
  if (note === '') return null
  if (note.length > USER_NOTE_MAX_LENGTH) throw new InvalidNoteError()

  return note
}
