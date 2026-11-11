import { describe, expect, it } from 'vitest'
import { DEFAULT_MEDIA_TYPES } from '../../../../../server/src/ingestion/mediaTypes.js'
import { bannerFor, CATEGORY_BANNERS } from './categoryBanners.js'

/**
 * eX-Zed's category banners (X-006, 50.9): the registry key → the raster art the list header and the Choose Your Fighter tile draw. Sizes are the Category art README's, in art
 * pixels (the stylesheet draws two screen pixels to each); the open-registry rule: a key with no entry draws nothing and never throws.
 */
describe('the banner map', () => {
  it('has an entry for every key the real media-type registry ships today', () => {
    for (const mediaType of DEFAULT_MEDIA_TYPES) expect(bannerFor(mediaType.key), `${mediaType.key} has banner art`).not.toBeNull()
  })

  it('has no entry for a key the registry does not ship (the map is by registry key, not a second list of categories)', () => {
    const shipped = new Set(DEFAULT_MEDIA_TYPES.map((mediaType) => mediaType.key))

    expect(Object.keys(CATEGORY_BANNERS).filter((key) => !shipped.has(key))).toEqual([])
  })

  it('an unknown key, or one that is a property of every object, has none and does not throw', () => {
    for (const key of ['podcast', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => bannerFor(key), key).not.toThrow()
      expect(bannerFor(key), key).toBeNull()
    }
  })

  it('gives the README’s sizes in art pixels for the list header', () => {
    const sizes = Object.fromEntries(Object.entries(CATEGORY_BANNERS).map(([key, set]) => [key, `${set.header.file} ${set.header.w}x${set.header.h}`]))

    expect(sizes).toEqual({
      movie: 'movies 193x53',
      tv: 'tv-series 154x58',
      animation: 'animation 182x74',
      documentary: 'documentaries 201x50',
      wrestling: 'pro-wrestling 202x54',
      mma: 'mma 202x60',
      game: 'games 230x56',
      comic: 'comics 203x71',
      book: 'books 186x57',
      music: 'music 199x46',
      youtube: 'youtube 193x81',
      mega: 'mega 203x60',
    })
  })

  it('the tile is the header’s art, except Pro Wrestling, whose tile has its own ring-only file', () => {
    for (const [key, set] of Object.entries(CATEGORY_BANNERS)) {
      if (key === 'wrestling') continue
      expect(set.tile.file, key).toBe(set.header.file)
      expect([set.tile.w, set.tile.h], key).toEqual([set.header.w, set.header.h])
    }
    expect(CATEGORY_BANNERS.wrestling!.tile).toMatchObject({ file: 'pro-wrestling-tile', w: 151, h: 54 })
  })

  it('crops a tile’s art from the right for Movies and Documentaries and from the middle for the rest, as the board does', () => {
    const right = Object.entries(CATEGORY_BANNERS).filter(([, set]) => set.tile.x === '100%').map(([key]) => key)

    expect(right.sort()).toEqual(['documentary', 'movie'])
    for (const [key, set] of Object.entries(CATEGORY_BANNERS)) expect(['50%', '100%'], key).toContain(set.tile.x)
  })
})
