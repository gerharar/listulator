import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalExternalRef,
  canonicalPathFromExternalRef,
  CustomListParseError,
  expandCanonicalList,
  fetchCanonicalList,
  fetchCanonicalManifest,
  isSafeCanonicalPath,
  parseCustomList,
  searchCanonicalLists,
  searchLibrary,
} from './customLists.js'
import { IngestionError, type FetchLike } from './http.js'

const CATEGORIES = new Set(['movie', 'tv', 'book', 'mega'])

function fixture(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url)), 'utf8')
}

describe('parseCustomList', () => {
  it('parses a minimal valid list', () => {
    const yaml = `
title: Some List
category: movie
items:
  - { title: First, year: 2000, minutes: 90 }
  - { title: Second }
`
    expect(parseCustomList(yaml, CATEGORIES)).toEqual({
      title: 'Some List',
      category: 'movie',
      items: [
        { title: 'First', year: 2000, minutes: 90 },
        { title: 'Second' },
      ],
    })
  })

  it('preserves an optional group label per item', () => {
    const yaml = `
title: Grouped
category: tv
items:
  - { title: Pilot, group: Season 1 }
`
    expect(parseCustomList(yaml, CATEGORIES).items).toEqual([{ title: 'Pilot', group: 'Season 1' }])
  })

  it('preserves an optional tags list per item', () => {
    const yaml = `
title: Some Band — Discography
category: movie
items:
  - { title: Global Evisceration, tags: [Album, Live] }
`
    expect(parseCustomList(yaml, CATEGORIES).items).toEqual([
      { title: 'Global Evisceration', tags: ['Album', 'Live'] },
    ])
  })

  it('preserves an optional notes field per item, trimmed', () => {
    const yaml =
      'title: X\ncategory: movie\nitems:\n' +
      '  - { title: A Game (PS3), notes: "  Extra missions on this platform.  " }\n'

    expect(parseCustomList(yaml, CATEGORIES).items).toEqual([
      { title: 'A Game (PS3)', notes: 'Extra missions on this platform.' },
    ])
  })

  it('leaves notes absent when an item has none', () => {
    const yaml = 'title: X\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(parseCustomList(yaml, CATEGORIES).items[0]).not.toHaveProperty('notes')
  })

  it('rejects a non-string notes value', () => {
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, notes: 5 }\n', CATEGORIES),
    ).toThrow(CustomListParseError)
  })

  it('rejects notes over 2048 characters, naming the item and the cap', () => {
    const yaml = `title: X\ncategory: movie\nitems:\n  - { title: X, notes: "${'a'.repeat(2049)}" }\n`

    try {
      parseCustomList(yaml, CATEGORIES)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CustomListParseError)
      expect((error as CustomListParseError).code).toBe('list.fileItemNotesTooLong')
      expect((error as CustomListParseError).params).toEqual({ index: 1, max: 2048 })
    }
  })

  it('accepts notes at exactly 2048 characters', () => {
    const yaml = `title: X\ncategory: movie\nitems:\n  - { title: X, notes: "${'a'.repeat(2048)}" }\n`
    expect(parseCustomList(yaml, CATEGORIES).items[0]?.notes).toHaveLength(2048)
  })

  it('trims notes before checking the cap, so trailing whitespace does not fail it', () => {
    const padded = `${'a'.repeat(2048)}   `
    const yaml = `title: X\ncategory: movie\nitems:\n  - { title: X, notes: "${padded}" }\n`
    expect(parseCustomList(yaml, CATEGORIES).items[0]?.notes).toHaveLength(2048)
  })

  it('trims the top-level title', () => {
    const yaml = 'title: "  Padded  "\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(parseCustomList(yaml, CATEGORIES).title).toBe('Padded')
  })

  it('preserves an optional top-level description, trimmed', () => {
    const yaml = 'title: X\ndescription: "  A long-running procedural.  "\ncategory: tv\nitems: []\n'
    expect(parseCustomList(yaml, CATEGORIES).description).toBe('A long-running procedural.')
  })

  it('omits description when not set', () => {
    const yaml = 'title: X\ncategory: movie\nitems: []\n'
    expect(parseCustomList(yaml, CATEGORIES).description).toBeUndefined()
  })

  it('preserves an optional top-level status', () => {
    const yaml = 'title: X\ncategory: tv\nstatus: ongoing\nitems: []\n'
    expect(parseCustomList(yaml, CATEGORIES).status).toBe('ongoing')
  })

  it('rejects a status that is not exactly complete or ongoing', () => {
    const yaml = 'title: X\ncategory: tv\nstatus: finished\nitems: []\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects unparseable YAML, saying which line', () => {
    // The Import tab's sentence is "Syntax error on line N" (design rules).
    expect(() => parseCustomList('title: X\ncategory: movie\nitems: [unclosed', CATEGORIES)).toThrow(
      CustomListParseError,
    )
    try {
      parseCustomList('title: X\ncategory: movie\nitems: [unclosed', CATEGORIES)
    } catch (error) {
      expect((error as CustomListParseError).code).toBe('list.fileSyntax')
      expect((error as CustomListParseError).params?.['line']).toBe(3)
    }
  })

  it('says "no items" when the items key is missing', () => {
    expect(() => parseCustomList('title: X\ncategory: movie\n', CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileNoItems' }),
    )
  })

  it('rejects a document that is not a mapping', () => {
    expect(() => parseCustomList('- just\n- a\n- list', CATEGORIES)).toThrow(CustomListParseError)
  })

  it('rejects a missing top-level title', () => {
    const yaml = 'category: movie\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileMissingTitle' }),
    )
  })

  it('rejects a blank top-level title', () => {
    const yaml = 'title: "   "\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileMissingTitle' }),
    )
  })

  it('rejects an unknown category, naming it', () => {
    const yaml = 'title: X\ncategory: not-a-real-category\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.unknownCategory', params: { key: 'not-a-real-category' } }),
    )
  })

  it('rejects a missing category', () => {
    const yaml = 'title: X\nitems:\n  - { title: X }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects items that is not an array', () => {
    const yaml = 'title: X\ncategory: movie\nitems: not-an-array\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects an item missing a title, naming its position', () => {
    const yaml = 'title: X\ncategory: movie\nitems:\n  - { title: First }\n  - { year: 2000 }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileItemMissingTitle', params: { index: 2 } }),
    )
  })

  it('rejects an unknown top-level field', () => {
    const yaml = 'title: X\ncategory: movie\nitems: []\nextra: true\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects an unknown per-item field', () => {
    const yaml = 'title: X\ncategory: movie\nitems:\n  - { title: X, minute: 90 }\n'
    expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  it('rejects a non-number year or minutes, and a non-string group', () => {
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, year: "2000" }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, minutes: "90" }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, group: 5 }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
  })

  it('rejects a non-array tags, and a tags array containing a non-string', () => {
    expect(() =>
      parseCustomList('title: X\ncategory: movie\nitems:\n  - { title: X, tags: Album }\n', CATEGORIES),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
    expect(() =>
      parseCustomList(
        'title: X\ncategory: movie\nitems:\n  - { title: X, tags: [Album, 5] }\n',
        CATEGORIES,
      ),
    ).toThrow(expect.objectContaining({ code: 'list.fileInvalid' }))
  })

  it('refuses a custom/executable tag outright — the actual safety guarantee', () => {
    // js-yaml's default `load()` (v4+) refuses any tag outside plain YAML —
    // `!!js/function` and friends only exist under the opt-in FULL_SCHEMA,
    // which this parser must never pass.
    expect(() =>
      parseCustomList('title: !!js/function "() => 1"\ncategory: movie\nitems: []\n', CATEGORIES),
    ).toThrow(CustomListParseError)
  })

  it('a YAML merge key smuggling extra top-level fields is still rejected', () => {
    // `<<` merge keys ARE a standard feature js-yaml's default loader
    // processes (not something this parser disables) — verified directly
    // against js-yaml rather than assumed. What actually stops one here is
    // the plain top-level field allowlist below: a merge that introduces any
    // field beyond title/category/items is rejected the same as a typo'd
    // field name would be.
    const merge = 'title: X\ncategory: movie\nitems: []\nanchor: &a { x: 1 }\n<<: *a\n'
    expect(() => parseCustomList(merge, CATEGORIES)).toThrow(
      expect.objectContaining({ code: 'list.fileInvalid' }),
    )
  })

  describe('errors say what is wrong, so a curator can fix the file unaided', () => {
    const FIELDS = '(allowed: title, description, category, status, items)'
    const ITEM_FIELDS = '(allowed: title, year, minutes, group, tags, notes)'
    const head = 'title: X\ncategory: movie\n'

    const cases: Array<[string, string, string]> = [
      ['a list at the top level', '- just\n- a\n- list', 'the file must be a mapping of fields, but it is a list'],
      ['an empty file', '', 'the file must be a mapping of fields, but it is empty'],
      ['an unknown top-level field', `${head}items: []\nextra: true\n`, `unknown top-level field "extra" ${FIELDS}`],
      ['a description that is not text', `${head}description: 5\nitems: []\n`, '"description" must be text, but it is the number 5'],
      ['a missing category', 'title: X\nitems:\n  - { title: X }\n', '"category" is missing'],
      ['a bad status', `${head}status: finished\nitems: []\n`, '"status" must be "complete" or "ongoing", but it is text "finished"'],
      ['items that is not a list', `${head}items: nope\n`, '"items" must be a list, but it is text "nope"'],
      ['an item that is not a mapping', `${head}items:\n  - { title: A }\n  - just text\n`, 'item 2 must be a mapping like { title: …, year: … }, but it is text "just text"'],
      [
        'a misspelled item field, suggesting the right one',
        `${head}items:\n  - { title: A }\n  - { title: "Mastermind", note: hi }\n`,
        `item 2 ("Mastermind"): unknown field "note" ${ITEM_FIELDS}; did you mean "notes"?`,
      ],
      ['an unrelated item field, with no suggestion', `${head}items:\n  - { title: A, colour: red }\n`, `item 1 ("A"): unknown field "colour" ${ITEM_FIELDS}`],
      ['a year in quotes', `${head}items:\n  - { title: A, year: "2000" }\n`, 'item 1 ("A"): "year" must be a number, but it is text "2000"'],
      ['minutes in quotes', `${head}items:\n  - { title: A, minutes: "90" }\n`, 'item 1 ("A"): "minutes" must be a number, but it is text "90"'],
      ['a group that is a number', `${head}items:\n  - { title: A, group: 5 }\n`, 'item 1 ("A"): "group" must be text, but it is the number 5'],
      ['notes that are a list', `${head}items:\n  - { title: A, notes: [x] }\n`, 'item 1 ("A"): "notes" must be text, but it is a list'],
      ['tags that is text', `${head}items:\n  - { title: A, tags: Album }\n`, 'item 1 ("A"): "tags" must be a list of text, but it is text "Album"'],
      ['a tag that is not text', `${head}items:\n  - { title: A, tags: [Album, 5] }\n`, 'item 1 ("A"): "tags" must be a list of text, but entry 2 is the number 5'],
    ]

    it.each(cases)('%s', (_name, yaml, detail) => {
      expect(() => parseCustomList(yaml, CATEGORIES)).toThrow(
        expect.objectContaining({ code: 'list.fileInvalid', params: { detail } }),
      )
    })

    it('cuts a long echoed value, so a pasted wall of text does not become the error', () => {
      const long = 'x'.repeat(200)
      try {
        parseCustomList(`${head}items: ${long}\n`, CATEGORIES)
        expect.unreachable()
      } catch (error) {
        const detail = String((error as CustomListParseError).params?.['detail'])
        expect(detail.length).toBeLessThan(100)
        expect(detail).toContain('…')
      }
    })

    it('puts the same words in the error message, which is all a command-line tool prints', () => {
      expect(() => parseCustomList(`${head}items:\n  - { title: A, note: hi }\n`, CATEGORIES)).toThrow(
        'list.fileInvalid: item 1 ("A"): unknown field "note"',
      )
    })

    it('says the same for every other code', () => {
      const message = (yaml: string) => {
        try {
          parseCustomList(yaml, CATEGORIES)
        } catch (error) {
          return (error as Error).message
        }
        return ''
      }
      expect(message('title: X\ncategory: movie\nitems: [unclosed')).toBe('list.fileSyntax: YAML syntax error on line 3')
      expect(message('title: X\ncategory: movie\n')).toBe('list.fileNoItems: the file has no "items"')
      expect(message('category: movie\nitems: []\n')).toBe('list.fileMissingTitle: the list has no "title"')
      expect(message('title: X\ncategory: nope\nitems: []\n')).toBe('list.unknownCategory: unknown category "nope"')
      expect(message('title: X\ncategory: movie\nitems:\n  - { year: 1 }\n')).toBe('list.fileItemMissingTitle: item 1 has no "title"')
      expect(message(`${head}items:\n  - { title: A, notes: "${'n'.repeat(3000)}" }\n`)).toBe(
        'list.fileItemNotesTooLong: item 1\'s "notes" are over 2048 characters',
      )
    })
  })

  describe('against the real example files from task 7.1', () => {
    const realCategories = new Set([
      'movie',
      'tv',
      'animation',
      'documentary',
      'wrestling',
      'mma',
      'game',
      'comic',
      'book',
      'music',
      'youtube',
      'mega',
    ])

    it('parses the Marvel Cinematic Universe example', () => {
      const parsed = parseCustomList(fixture('lists/mega/marvel-cinematic-universe.yaml'), realCategories)

      expect(parsed.category).toBe('mega')
      expect(parsed.items).toHaveLength(23)
      expect(parsed.items[0]).toEqual({ title: 'Iron Man', year: 2008, minutes: 126 })
      expect(parsed.items.every((item) => item.minutes !== undefined)).toBe(true)
    })

    it('parses the Lord of the Rings example, with minutes omitted', () => {
      const parsed = parseCustomList(fixture('lists/book/lord-of-the-rings.yaml'), realCategories)

      expect(parsed.category).toBe('book')
      expect(parsed.items).toEqual([
        { title: 'The Fellowship of the Ring', year: 1954 },
        { title: 'The Two Towers', year: 1954 },
        { title: 'The Return of the King', year: 1955 },
      ])
      expect(parsed.items.every((item) => item.minutes === undefined)).toBe(true)
    })
  })
})

/** Every kind of path the guard has to refuse: shared by the guard's own tests and by the functions that fetch. */
const UNSAFE_PATHS: [string, string][] = [

  ['empty string', ''],
  ['leading slash', '/etc/passwd'],
  ['parent-directory traversal', '../../other-repo/main/secret.yaml'],
  ['a traversal segment mid-path', 'lists/../../../secret.yaml'],
  ['a scheme', 'https://evil.example/x.yaml'],
  ['a backslash', 'lists\\..\\..\\secret.yaml'],
  // Review 2026-10-04: `fetch`'s URL parser reads %2e%2e as "..", so this reached another repo's file.
  ['an encoded traversal', '%2e%2e/%2e%2e/%2e%2e/evil/repo/main/x.yaml'],
  ['a half-encoded traversal', '.%2E/.%2E/.%2E/evil/repo/main/x.yaml'],
  ['an encoded slash', 'lists%2F..%2F..%2Fsecret.yaml'],
  ['a query', 'lists/x.yaml?ref=other'],
  ['a fragment', 'lists/x.yaml#x'],
  // Passes the character check: the URL parser drops the tab, and ".\t." becomes "..". Only the comparison of the
  // URL requested with the path as written catches it.
  ['a traversal split by a tab', '.\t./.\t./.\t./evil/repo/main/x.yaml'],
  ['a name the URL would rewrite (a space)', 'lists/my list.yaml'],
]

describe('isSafeCanonicalPath', () => {
  it('accepts a plain relative path', () => {
    expect(isSafeCanonicalPath('lists/mega/marvel-cinematic-universe.yaml')).toBe(true)
  })

  it.each(UNSAFE_PATHS)('rejects %s', (_label, path) => {
    expect(isSafeCanonicalPath(path)).toBe(false)
  })

  it('accepts every path the library index lists', () => {
    const entries = JSON.parse(fixture('lists/index.json')) as { path: string }[]

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.filter((entry) => !isSafeCanonicalPath(entry.path))).toEqual([])
  })
})

describe('canonicalExternalRef / canonicalPathFromExternalRef', () => {
  it('round-trips a path', () => {
    const ref = canonicalExternalRef('lists/book/lord-of-the-rings.yaml')
    expect(canonicalPathFromExternalRef(ref)).toBe('lists/book/lord-of-the-rings.yaml')
  })

  it('returns undefined for a ref that is not a canonical sync', () => {
    expect(canonicalPathFromExternalRef('some-tmdb-collection-id')).toBeUndefined()
    expect(canonicalPathFromExternalRef(null)).toBeUndefined()
  })
})

describe('fetchCanonicalManifest', () => {
  function respondWith(body: unknown, status = 200): FetchLike {
    return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))
  }

  it('fetches and returns a valid manifest', async () => {
    const manifest = [
      { path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' },
      { path: 'lists/book/lotr.yaml', title: 'LOTR', category: 'book' },
    ]

    expect(await fetchCanonicalManifest(respondWith(manifest))).toEqual(manifest)
  })

  it('rejects a manifest that is not an array', async () => {
    await expect(fetchCanonicalManifest(respondWith({ not: 'an array' }))).rejects.toThrow(IngestionError)
  })

  it('rejects a manifest entry missing a required field', async () => {
    await expect(
      fetchCanonicalManifest(respondWith([{ path: 'x.yaml', title: 'X' }])),
    ).rejects.toThrow(IngestionError)
  })

  it('rejects a manifest entry with an unsafe path', async () => {
    await expect(
      fetchCanonicalManifest(respondWith([{ path: '../../escape.yaml', title: 'X', category: 'movie' }])),
    ).rejects.toThrow(IngestionError)
  })

  it('surfaces a 404 as a clean IngestionError — the repo is genuinely private right now', async () => {
    await expect(fetchCanonicalManifest(respondWith('404: Not Found', 404))).rejects.toThrow(IngestionError)
  })

  it('accepts an entry with description and status, and carries both through', async () => {
    const manifest = [
      {
        path: 'lists/mega/mcu.yaml',
        title: 'MCU',
        category: 'mega',
        description: 'Every film, in release order.',
        status: 'complete',
      },
    ]

    expect(await fetchCanonicalManifest(respondWith(manifest))).toEqual(manifest)
  })

  it('still validates an old-shape entry with neither field', async () => {
    const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' }]

    expect(await fetchCanonicalManifest(respondWith(manifest))).toEqual(manifest)
  })

  it('carries an optional item count through', async () => {
    const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega', itemCount: 23 }]

    expect(await fetchCanonicalManifest(respondWith(manifest))).toEqual(manifest)
  })

  it('rejects an item count that is not a whole number of zero or more', async () => {
    for (const itemCount of [-1, 2.5, '23', null]) {
      await expect(
        fetchCanonicalManifest(respondWith([{ path: 'x.yaml', title: 'X', category: 'movie', itemCount }])),
      ).rejects.toThrow(IngestionError)
    }
  })

  it('rejects an entry whose status is not complete or ongoing', async () => {
    await expect(
      fetchCanonicalManifest(
        respondWith([{ path: 'x.yaml', title: 'X', category: 'movie', status: 'finished' }]),
      ),
    ).rejects.toThrow(IngestionError)
  })
})

describe('searchCanonicalLists', () => {
  function respondWith(body: unknown, status = 200): FetchLike {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }))
  }

  it('carries description and status through onto a matching result', async () => {
    const manifest = [
      {
        path: 'lists/mega/mcu.yaml',
        title: 'MCU',
        category: 'mega',
        description: 'Every film, in release order.',
        status: 'complete',
      },
    ]

    const results = await searchCanonicalLists('mega', 'mcu', respondWith(manifest))

    expect(results).toEqual([
      {
        externalRef: 'canonical:lists/mega/mcu.yaml',
        title: 'MCU',
        detail: 'Canonical list',
        description: 'Every film, in release order.',
        status: 'complete',
      },
    ])
  })

  it('carries the item count the manifest holds, so a caller can say how long a list is without fetching it', async () => {
    const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega', itemCount: 23 }]

    const results = await searchCanonicalLists('mega', 'mcu', respondWith(manifest))

    expect(results).toEqual([
      { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'MCU', detail: 'Canonical list', itemCount: 23 },
    ])
  })

  it('has no item count when an older manifest lacks one', async () => {
    const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' }]

    const [result] = await searchCanonicalLists('mega', 'mcu', respondWith(manifest))

    expect(result).not.toHaveProperty('itemCount')
  })

  it('omits description and status entirely when the manifest entry has neither', async () => {
    const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' }]

    const results = await searchCanonicalLists('mega', 'mcu', respondWith(manifest))

    expect(results).toEqual([
      { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'MCU', detail: 'Canonical list' },
    ])
    expect(results[0]).not.toHaveProperty('description')
    expect(results[0]).not.toHaveProperty('status')
  })
})

describe('fetchCanonicalList', () => {
  function respondWithText(body: string, status = 200): FetchLike {
    return vi.fn(async () => new Response(body, { status }))
  }

  it('fetches and parses a real list file', async () => {
    const yaml = 'title: MCU\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n'
    const parsed = await fetchCanonicalList('lists/mega/mcu.yaml', new Set(['mega']), respondWithText(yaml))

    expect(parsed).toEqual({ title: 'MCU', category: 'mega', items: [{ title: 'Iron Man', year: 2008 }] })
  })

  it('propagates a parse error through the same CustomListParseError as any other source', async () => {
    const yaml = 'title: X\ncategory: not-real\nitems: []\n'

    await expect(
      fetchCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText(yaml)),
    ).rejects.toThrow(CustomListParseError)
  })

  it('surfaces a fetch failure as IngestionError', async () => {
    await expect(
      fetchCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText('404: Not Found', 404)),
    ).rejects.toThrow(IngestionError)
  })

  // SR-053 (security review): the guard used to sit in each caller, so a new caller that forgot it could make a
  // reference choose a path the URL parser turns into another repository. The function that builds the URL checks.
  it.each(UNSAFE_PATHS)('refuses %s itself, and sends no request', async (_label, path) => {
    const fetchImpl = respondWithText('title: X\ncategory: mega\nitems:\n  - { title: A }\n')

    await expect(fetchCanonicalList(path, new Set(['mega']), fetchImpl)).rejects.toMatchObject({
      name: 'CustomListParseError',
      code: 'list.fileInvalid',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks for the file by its exact path on the one repository and branch', async () => {
    const fetchImpl = respondWithText('title: X\ncategory: mega\nitems:\n  - { title: A }\n')

    await fetchCanonicalList('lists/mega/mcu.yaml', new Set(['mega']), fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchImpl).mock.calls[0]![0]).toBe('https://raw.githubusercontent.com/gerharar/listulator/main/lists/mega/mcu.yaml')
  })
})

describe('expandCanonicalList', () => {
  function respondWithText(body: string, status = 200): FetchLike {
    return vi.fn(async () => new Response(body, { status }))
  }

  it.each(UNSAFE_PATHS)('refuses %s itself, and sends no request (SR-053)', async (_label, path) => {
    const fetchImpl = respondWithText('title: X\ncategory: mega\nitems:\n  - { title: A }\n')

    await expect(expandCanonicalList(path, new Set(['mega']), fetchImpl)).rejects.toMatchObject({ code: 'list.fileInvalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('carries tags through into the candidate shape, same as group', () => {
    const yaml = `
title: Some Band — Discography
category: music
items:
  - { title: Global Evisceration, tags: [Album, Live] }
  - { title: Debut Album, tags: [Album] }
`
    return expandCanonicalList('lists/x.yaml', new Set(['music']), respondWithText(yaml)).then(
      ({ items: candidates }) => {
        expect(candidates).toEqual([
          { title: 'Global Evisceration', tags: ['Album', 'Live'] },
          { title: 'Debut Album', tags: ['Album'] },
        ])
      },
    )
  })

  it('omits tags entirely when an item has none', async () => {
    const yaml = 'title: X\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n'
    const { items: candidates } = await expandCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText(yaml))

    expect(candidates).toEqual([{ title: 'Iron Man', year: 2008 }])
  })

  it('carries notes through into the candidate shape, so a canonical refresh or Reset does not drop them', async () => {
    const yaml =
      'title: X\ncategory: game\nitems:\n  - { title: A Game (PS3), notes: Extra missions here. }\n'
    const { items: candidates } = await expandCanonicalList('lists/x.yaml', new Set(['game']), respondWithText(yaml))

    expect(candidates).toEqual([{ title: 'A Game (PS3)', notes: 'Extra missions here.' }])
  })

  it("carries the file's own top-level status, since the curator is the source of truth for it", async () => {
    const yaml = 'title: X\ncategory: mega\nstatus: ongoing\nitems:\n  - { title: Iron Man }\n'
    const expansion = await expandCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText(yaml))

    expect(expansion.status).toBe('ongoing')
  })

  it('reports no status at all when the file sets none', async () => {
    const yaml = 'title: X\ncategory: mega\nitems:\n  - { title: Iron Man }\n'
    const expansion = await expandCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText(yaml))

    expect('status' in expansion).toBe(false)
  })
})

describe('searchLibrary', () => {
  const manifest = [{ path: 'lists/mega/mcu.yaml', title: 'MCU', category: 'mega' }]

  it('returns the matches and says the library was reachable', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify(manifest), { status: 200 })

    expect(await searchLibrary('mega', 'mcu', fetchImpl)).toEqual({
      matches: [
        { externalRef: 'canonical:lists/mega/mcu.yaml', title: 'MCU', detail: 'Canonical list' },
      ],
      reachable: true,
    })
  })

  it('is still reachable when nothing matches — an empty answer is not an outage', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify(manifest), { status: 200 })

    expect(await searchLibrary('mega', 'zzz', fetchImpl)).toEqual({ matches: [], reachable: true })
  })

  it('reports the library unreachable when it answers 404 (a private or missing repo)', async () => {
    const fetchImpl: FetchLike = async () => new Response('404: Not Found', { status: 404 })

    expect(await searchLibrary('mega', 'mcu', fetchImpl)).toEqual({ matches: [], reachable: false })
  })

  it('reports the library unreachable when the network is down', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError('Failed to fetch')
    }

    expect(await searchLibrary('mega', 'mcu', fetchImpl)).toEqual({ matches: [], reachable: false })
  })

  it('keeps searchCanonicalLists returning just the matches, for callers that never cared', async () => {
    const fetchImpl: FetchLike = async () => new Response('nope', { status: 500 })

    expect(await searchCanonicalLists('mega', 'mcu', fetchImpl)).toEqual([])
  })
})
