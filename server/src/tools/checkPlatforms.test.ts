import { describe, expect, it } from 'vitest'
import { comparePlatforms } from './checkPlatforms.js'

describe('comparePlatforms', () => {
  const rows = [
    { igdbId: 6, name: 'Windows', code: 'WIN' },
    { igdbId: 14, name: 'Macintosh', code: 'MAC' },
  ]

  it('finds nothing to do when IGDB and the file agree', () => {
    expect(comparePlatforms([{ id: 6, name: 'PC' }, { id: 14, name: 'Mac' }], rows)).toEqual({ missing: [], gone: [] })
  })

  it('lists IGDB platforms the file lacks, as rows to paste (name filled, code left for the owner)', () => {
    const result = comparePlatforms([{ id: 6, name: 'PC' }, { id: 14, name: 'Mac' }, { id: 999, name: 'New Box' }], rows)

    expect(result.missing).toEqual(['999;New Box;'])
  })

  it('lists rows whose platform IGDB no longer has', () => {
    expect(comparePlatforms([{ id: 6, name: 'PC' }], rows).gone).toEqual(['14;Macintosh;MAC'])
  })
})
