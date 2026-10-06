import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_LIST_ITEMS, NAME_MAX_LENGTH } from '../catalog/limits.js'
import { ITEM_NOTES_MAX_LENGTH, parseCustomList } from './customLists.js'
import { createMediaTypeRegistry } from './mediaTypes.js'

/**
 * What a committed list file may contain (security review, Phase 19, task 19.4; docs/security-review.md SR-019, SR-020).
 *
 * Every installed app fetches `lists/` from `main` and shows it as written, so the owner's review of a list pull
 * request is the only gate. The parser checks the shape of a file, not its content: it accepts a `minutes` of
 * `.inf`, a negative one, 200,000 items, a 5 MB title, and right-to-left or invisible characters. This test is the
 * hand review's automatic half: it runs every tracked list file through the rules below, which hold for the whole
 * library today with room to spare (the largest list has 757 items, the longest title 92 characters). A list that
 * needs more changes the rule here, in the same pull request, and says why.
 *
 * Not a fix for the parser (that is a task of its own): a file edited by hand, or fetched by an app, never passes
 * through this test.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CATEGORIES = new Set(createMediaTypeRegistry().keys())

/** The most a list file, and the manifest, may weigh. The largest list is 44 KB. */
const FILE_MAX_BYTES = 256 * 1024
const DESCRIPTION_MAX_LENGTH = 1_000
const TAGS_MAX = 20
const TAG_MAX_LENGTH = 64
const MINUTES_RANGE = [1, 100_000] as const
const YEAR_RANGE = [1800, 2100] as const

/**
 * The character classes are written as escapes inside strings, never as the characters themselves: an invisible
 * character in this file would be invisible to its reader too.
 */
const classOf = (ranges: string): RegExp => new RegExp(`[${ranges}]`)

/** Control characters other than tab, newline and carriage return (C0, DEL and C1). */
const CONTROL = classOf('\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F')
/** Characters that reorder or hide text: right-to-left marks and overrides, isolates. */
const BIDI = classOf('\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069')
/** Zero-width, joiner, word-joiner, byte-order mark and soft hyphen: invisible, so two titles can look the same. */
const INVISIBLE = classOf('\\u00AD\\u200B-\\u200D\\u2060\\uFEFF')
/** `http://`, `javascript://` style addresses: the app shows list text as text, so a link has no business in one. */
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\//i

/** The hazards a piece of text can carry. Checked on the file as written and on every string it parses to. */
function textProblems(text: string, where: string): string[] {
  const problems: string[] = []

  if (CONTROL.test(text)) problems.push(`${where} contains a control character`)
  if (BIDI.test(text)) problems.push(`${where} contains a right-to-left or direction-changing character`)
  if (INVISIBLE.test(text)) problems.push(`${where} contains a zero-width or invisible character`)
  if (text !== text.normalize('NFC')) problems.push(`${where} is not in Unicode normal form C (composed accents)`)
  if (ADDRESS.test(text)) problems.push(`${where} contains an address (scheme://)`)

  return problems
}

/** Every rule a list file breaks, as sentences; empty when it breaks none. */
function listFileProblems(text: string): string[] {
  const problems: string[] = []

  if (Buffer.byteLength(text) > FILE_MAX_BYTES) problems.push(`the file is over ${FILE_MAX_BYTES} bytes`)
  // As written: a character pasted into the file. And as parsed: a YAML escape (`\u202E` inside quotes) is plain
  // ASCII in the file and a right-to-left override once read, so the file alone proves nothing.
  problems.push(...textProblems(text, 'the file'))

  const list = parseCustomList(text, CATEGORIES)
  const number = (value: number | undefined, [min, max]: readonly [number, number]) =>
    value === undefined || (Number.isInteger(value) && value >= min && value <= max)

  if (list.items.length > MAX_LIST_ITEMS) problems.push(`has ${list.items.length} items (the most is ${MAX_LIST_ITEMS})`)
  if (list.title.length > NAME_MAX_LENGTH) problems.push(`has a title over ${NAME_MAX_LENGTH} characters`)
  if ((list.description?.length ?? 0) > DESCRIPTION_MAX_LENGTH) problems.push(`has a description over ${DESCRIPTION_MAX_LENGTH} characters`)

  problems.push(...textProblems(list.title, 'the list title'))
  problems.push(...textProblems(list.description ?? '', 'the description'))

  list.items.forEach((item, index) => {
    const at = `item ${index + 1} ("${item.title.slice(0, 40)}")`
    for (const [field, value] of [['title', item.title], ['group', item.group], ['notes', item.notes], ...(item.tags ?? []).map((tag) => ['tag', tag] as const)] as const) {
      problems.push(...textProblems(value ?? '', `${at}'s ${field}`))
    }
    if (item.title.length > NAME_MAX_LENGTH) problems.push(`${at} has a title over ${NAME_MAX_LENGTH} characters`)
    if ((item.group?.length ?? 0) > NAME_MAX_LENGTH) problems.push(`${at} has a group over ${NAME_MAX_LENGTH} characters`)
    if ((item.notes?.length ?? 0) > ITEM_NOTES_MAX_LENGTH) problems.push(`${at} has notes over ${ITEM_NOTES_MAX_LENGTH} characters`)
    if ((item.tags?.length ?? 0) > TAGS_MAX) problems.push(`${at} has more than ${TAGS_MAX} tags`)
    if (item.tags?.some((tag) => tag.length > TAG_MAX_LENGTH)) problems.push(`${at} has a tag over ${TAG_MAX_LENGTH} characters`)
    if (!number(item.minutes, MINUTES_RANGE)) problems.push(`${at} has minutes that are not a whole number from ${MINUTES_RANGE[0]} to ${MINUTES_RANGE[1]}`)
    if (!number(item.year, YEAR_RANGE)) problems.push(`${at} has a year that is not a whole number from ${YEAR_RANGE[0]} to ${YEAR_RANGE[1]}`)
  })

  return problems
}

const file = (items: string, top = 'title: T') => `${top}\ncategory: movie\nitems:\n${items}\n`
const one = (fields: string) => file(`  - title: A\n${fields}`)

describe('the rules for a list file, proven on hostile fixtures', () => {
  it('accept an ordinary list', () => {
    expect(listFileProblems(file('  - {title: "Dr. No", year: 1962, minutes: 109, tags: [non-canon]}'))).toEqual([])
  })

  it.each([
    ['infinite minutes', one('    minutes: .inf'), /minutes/],
    ['a negative runtime', one('    minutes: -5'), /minutes/],
    ['an absurd runtime', one('    minutes: 1e308'), /minutes/],
    ['fractional minutes', one('    minutes: 1.5'), /minutes/],
    ['a year far out of range', one('    year: 1e308'), /year/],
    ['a fractional year', one('    year: 2000.5'), /year/],
    ['a control character', one('    notes: "a\\u001bb"'), /control character/],
    ['a NUL', file('  - title: "a\\u0000b"'), /control character/],
    ['a right-to-left override', file('  - title: "Safe\\u202Etxt.exe"'), /right-to-left/],
    ['an invisible character', file('  - title: "Fa\\u200Bke"'), /invisible/],
    ['decomposed accents', file('  - title: "Cafe\\u0301"'), /normal form/],
    ['a web address', one('    notes: "see https://example.com/x"'), /address/],
    ['a javascript address', one('    notes: "javascript://%0aalert(1)"'), /address/],
    ['a title that is too long', file(`  - title: ${'x'.repeat(NAME_MAX_LENGTH + 1)}`), /title over/],
    ['a description that is too long', file('  - title: A', `title: T\ndescription: ${'d'.repeat(DESCRIPTION_MAX_LENGTH + 1)}`), /description over/],
    ['too many tags', one(`    tags: [${Array.from({ length: TAGS_MAX + 1 }, (_, n) => `t${n}`).join(', ')}]`), /tags/],
    ['a tag that is too long', one(`    tags: [${'t'.repeat(TAG_MAX_LENGTH + 1)}]`), /tag over/],
    ['too many items', file(Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, n) => `  - title: i${n}`).join('\n')), /items \(the most/],
    ['a file that is too big', file(`  - title: A\n    notes: "${'n'.repeat(1000)}"\n`.repeat(300)), /bytes/],
  ])('refuse %s', (_name, text, expected) => {
    expect(listFileProblems(text).join(' | ')).toMatch(expected)
  })
})

describe('the committed lists/ library, against those rules', () => {
  const tracked = execFileSync('git', ['ls-files', '--', 'lists/'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.endsWith('.yaml') || path.endsWith('.yml'))

  it('has list files to check (an empty list would pass every rule below on nothing)', () => {
    expect(tracked.length).toBeGreaterThan(50)
  })

  it.each(tracked)('%s breaks none', (path) => {
    expect(listFileProblems(readFileSync(`${REPO_ROOT}${path}`, 'utf8'))).toEqual([])
  })

  it('keeps the manifest small', () => {
    expect(readFileSync(`${REPO_ROOT}lists/index.json`).byteLength).toBeLessThan(FILE_MAX_BYTES)
  })
})
