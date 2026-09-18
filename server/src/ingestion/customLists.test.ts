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

  it('trims the top-level title', () => {
    const yaml = 'title: "  Padded  "\ncategory: movie\nitems:\n  - { title: X }\n'
    expect(parseCustomList(yaml, CATEGORIES).title).toBe('Padded')
  })

  it('rejects unparseable YAML', () => {
    expect(() => parseCustomList('title: [unclosed', CATEGORIES)).toThrow(CustomListParseError)
    try {
      parseCustomList('title: [unclosed', CATEGORIES)
    } catch (error) {
      expect((error as CustomListParseError).code).toBe('list.fileInvalid')
    }
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

describe('isSafeCanonicalPath', () => {
  it('accepts a plain relative path', () => {
    expect(isSafeCanonicalPath('lists/mega/marvel-cinematic-universe.yaml')).toBe(true)
  })

  it.each([
    ['empty string', ''],
    ['leading slash', '/etc/passwd'],
    ['parent-directory traversal', '../../other-repo/main/secret.yaml'],
    ['a traversal segment mid-path', 'lists/../../../secret.yaml'],
    ['a scheme', 'https://evil.example/x.yaml'],
    ['a backslash', 'lists\\..\\..\\secret.yaml'],
  ])('rejects %s', (_label, path) => {
    expect(isSafeCanonicalPath(path)).toBe(false)
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
})

describe('expandCanonicalList', () => {
  function respondWithText(body: string, status = 200): FetchLike {
    return vi.fn(async () => new Response(body, { status }))
  }

  it('carries tags through into the candidate shape, same as group', () => {
    const yaml = `
title: Some Band — Discography
category: music
items:
  - { title: Global Evisceration, tags: [Album, Live] }
  - { title: Debut Album, tags: [Album] }
`
    return expandCanonicalList('lists/x.yaml', new Set(['music']), respondWithText(yaml)).then(
      (candidates) => {
        expect(candidates).toEqual([
          { title: 'Global Evisceration', tags: ['Album', 'Live'] },
          { title: 'Debut Album', tags: ['Album'] },
        ])
      },
    )
  })

  it('omits tags entirely when an item has none', async () => {
    const yaml = 'title: X\ncategory: mega\nitems:\n  - { title: Iron Man, year: 2008 }\n'
    const candidates = await expandCanonicalList('lists/x.yaml', new Set(['mega']), respondWithText(yaml))

    expect(candidates).toEqual([{ title: 'Iron Man', year: 2008 }])
  })
})
