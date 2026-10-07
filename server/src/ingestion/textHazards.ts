/**
 * Characters that disguise or break text (security review, Phase 19, SR-019). A list is shown as written and text in React is
 * only text, so none of this runs; the harm is a title that reads as another (`Safe` + a right-to-left override + `txt.exe`)
 * or that hides characters. Shared by the list parser and the library manifest's checks. No Node imports: the desktop app
 * bundles this file.
 *
 * Deliberately not refused, because people really write them: zero-width joiners and non-joiners (emoji sequences, Persian
 * and Indic scripts), the left-to-right, right-to-left and Arabic letter marks (they fix punctuation in mixed-direction
 * text), and decomposed accents. The committed library's guard test is stricter (a curated library, reviewed by hand).
 *
 * The classes are written as escapes in strings, never as the characters themselves: an invisible character in this file would
 * be invisible to its reader too.
 */
const classOf = (ranges: string): RegExp => new RegExp(`[${ranges}]`)

/** C0, DEL and C1 controls, and the line and paragraph separators; a tab, newline and carriage return are controls too. */
const CONTROL = classOf('\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029')
/** The same, but a tab, a newline and a carriage return are allowed (notes and descriptions are prose). */
const CONTROL_EXCEPT_WHITESPACE = classOf('\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u2028\\u2029')
/** Embeddings, overrides and isolates: they reorder what is shown. */
const DIRECTION = classOf('\\u202A-\\u202E\\u2066-\\u2069')
/** Zero-width space, word joiner, byte-order mark and soft hyphen: invisible, so two titles can look the same. */
const INVISIBLE = classOf('\\u00AD\\u200B\\u2060\\uFEFF')
const ANY_HAZARD = classOf('\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069\\u00AD\\u200B\\u2060\\uFEFF')

/**
 * What is wrong with `text`, as the end of a sentence ("contains …"), or `undefined` when nothing is.
 * `multiline` is for notes and descriptions, which may hold line breaks; a title, group, tag or name may not.
 */
export function textHazard(text: string, multiline = false): string | undefined {
  if ((multiline ? CONTROL_EXCEPT_WHITESPACE : CONTROL).test(text)) return 'a control character'
  if (DIRECTION.test(text)) return 'a direction-changing character'
  if (INVISIBLE.test(text)) return 'an invisible character'

  return undefined
}

/** `text` with every hazardous character shown as `?`, for a message that must name a value without carrying the hazard. */
export function withoutHazards(text: string): string {
  return text.replace(new RegExp(ANY_HAZARD.source, 'g'), '?')
}
