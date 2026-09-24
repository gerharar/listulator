import { describe, expect, it } from 'vitest'
import { groupPreviewRows, parsePreviewPath, previewPath, summarizePreview } from './preview.js'

describe('previewPath / parsePreviewPath', () => {
  it('round-trips the source and its options through the layer path', () => {
    const path = previewPath({
      mediaType: 'music',
      externalRef: 'artist-1',
      title: 'Björk & Co',
      options: { includeEp: true, includeSingle: false },
    })

    expect(path.startsWith('/lists/preview?')).toBe(true)
    expect(parsePreviewPath(new URL(path, 'http://x').searchParams)).toEqual({
      mediaType: 'music',
      externalRef: 'artist-1',
      title: 'Björk & Co',
      options: { includeEp: true, includeSingle: false },
    })
  })

  it('round-trips the book options', () => {
    const path = previewPath({
      mediaType: 'book',
      externalRef: 'author:OL1A',
      title: 'X',
      options: { language: 'eng', includeUnknown: true },
    })

    expect(parsePreviewPath(new URL(path, 'http://x').searchParams)?.options).toEqual({
      language: 'eng',
      includeUnknown: true,
    })
  })

  it('carries no options when there are none', () => {
    const path = previewPath({ mediaType: 'tv', externalRef: 'show:1', title: 'T', options: {} })

    expect(parsePreviewPath(new URL(path, 'http://x').searchParams)?.options).toEqual({})
  })

  it('returns nothing when the source is missing', () => {
    expect(parsePreviewPath(new URLSearchParams('title=x'))).toBeNull()
  })
})

describe('summarizePreview', () => {
  it('counts items and adds up their runtimes', () => {
    expect(
      summarizePreview([{ title: 'A', timeToConsumeMinutes: 30 }, { title: 'B', timeToConsumeMinutes: 45 }], 60),
    ).toEqual({ count: 2, minutes: 75, estimated: false })
  })

  it('uses the category default where an item has no runtime, and says it is an estimate', () => {
    expect(summarizePreview([{ title: 'A', timeToConsumeMinutes: 30 }, { title: 'B' }], 60)).toEqual({
      count: 2,
      minutes: 90,
      estimated: true,
    })
  })

  it('handles an empty list', () => {
    expect(summarizePreview([], 60)).toEqual({ count: 0, minutes: 0, estimated: false })
  })
})

describe('groupPreviewRows', () => {
  it('opens a head each time the group changes, in arrival order', () => {
    const rows = groupPreviewRows([
      { title: 'Film' },
      { title: 'E1', group: 'S1' },
      { title: 'E2', group: 'S1' },
      { title: 'Film 2' },
      { title: 'E3', group: 'S1' },
    ])

    expect(rows.map((row) => (row.kind === 'group' ? `# ${row.label} (${row.count})` : row.item.title))).toEqual([
      'Film',
      '# S1 (2)',
      'E1',
      'E2',
      'Film 2',
      '# S1 (1)',
      'E3',
    ])
  })

  it('marks grouped items so they indent', () => {
    const rows = groupPreviewRows([{ title: 'A', group: 'G' }])

    expect(rows[1]).toMatchObject({ kind: 'item', grouped: true })
  })
})
