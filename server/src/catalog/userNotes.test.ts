import { describe, expect, it } from 'vitest'
import { InvalidNoteError, normalizeUserNote, USER_NOTE_MAX_LENGTH } from './userNotes.js'

/**
 * The user's own note on an item (H-003, BL-043; owner, 2026-10-15): text kept in a field of its own, never the curator's
 * `notes`. One module for the server, the desktop and (for the limit) the screens, as `years.ts` is for the year.
 */
describe('normalizeUserNote', () => {
  it('keeps a note as written, with its line breaks', () => {
    expect(normalizeUserNote('The serious one.\nWatch the Cantonese cut.')).toBe('The serious one.\nWatch the Cantonese cut.')
  })

  it('trims the spaces and line breaks around it', () => {
    expect(normalizeUserNote('  \n Skipped the first time. \n ')).toBe('Skipped the first time.')
  })

  it.each([null, undefined, '', '   ', '\n\n', ' \t '])('reads %j as no note', (text) => {
    expect(normalizeUserNote(text)).toBeNull()
  })

  it('writes every line break as a newline, so a note pasted from Windows is the same note', () => {
    expect(normalizeUserNote('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })

  it('keeps tabs, and takes out the controls and direction overrides that disguise or break text (SR-019)', () => {
    expect(normalizeUserNote('a\tb')).toBe('a\tb')
    expect(normalizeUserNote('a\u0000b')).toBe('ab')
    expect(normalizeUserNote('Safe‮txt.exe')).toBe('Safetxt.exe')
    expect(normalizeUserNote('x​y')).toBe('xy')
    expect(normalizeUserNote('‮')).toBeNull()
  })

  it('keeps what people really write: zero-width joiners in emoji and accents', () => {
    expect(normalizeUserNote('👩‍💻 café')).toBe('👩‍💻 café')
  })

  it('accepts a note of exactly 2,048 characters and refuses one more', () => {
    expect(USER_NOTE_MAX_LENGTH).toBe(2048)
    expect(normalizeUserNote('a'.repeat(2048))).toHaveLength(2048)
    expect(() => normalizeUserNote('a'.repeat(2049))).toThrow(InvalidNoteError)
  })

  it('counts a note after its line breaks are made newlines and it is trimmed', () => {
    expect(normalizeUserNote(`${'a\r\n'.repeat(1000)}a`)).toHaveLength(2001)
    expect(normalizeUserNote(`  ${'a'.repeat(2048)}  `)).toHaveLength(2048)
  })
})
