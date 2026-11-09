import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../../server/src/catalog/facets.js'
import { kindColumnChars } from './kindColumn.js'

/**
 * The kind tag's column under eX-Zed (Phase 49, found at Checkpoint D): design’s Tag card says every tag in a list is as wide as the longest tag
 * present. The width is counted in characters (`ch`), exact in a font whose characters are all as wide, and a flag’s mark after the label takes one more.
 */
describe('kindColumnChars', () => {
  it('is the length of the longest kind label in the list', () => {
    const items = [{ tags: ['Album'] }, { tags: ['Compilation'] }, { tags: ['EP'] }]

    expect(kindColumnChars(items, undefined)).toBe('Compilation'.length)
  })

  it('reads the label a row shows: the first tag when no convention names it', () => {
    expect(kindColumnChars([{ tags: ['English', 'German'] }, { tags: ['French'] }], undefined)).toBe('English'.length)
  })

  it('counts a flag’s mark as one more character, as the row draws it after the label', () => {
    const convention: FacetConvention = [
      { key: 'type', label: 'Type', values: ['Album', 'Single'] },
      { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
    ]

    expect(kindColumnChars([{ tags: ['Album', 'Live'] }, { tags: ['Single'] }], convention)).toBe('Album'.length + 1)
  })

  it('ignores items with no tags, and is 0 when none has one (the column is not drawn then)', () => {
    expect(kindColumnChars([{ tags: ['Book'] }, { tags: null }, {}], undefined)).toBe(4)
    expect(kindColumnChars([{ tags: [] }, { tags: null }, {}], undefined)).toBe(0)
    expect(kindColumnChars([], undefined)).toBe(0)
  })
})
