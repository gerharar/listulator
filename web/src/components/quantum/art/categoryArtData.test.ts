import { describe, expect, it } from 'vitest'
import { DEFAULT_MEDIA_TYPES } from '../../../../../server/src/ingestion/mediaTypes.js'
import { FALLBACK_ART, getCategoryArt } from './categoryArtData.js'

describe('getCategoryArt', () => {
  it('has real art for every key the real media-type registry ships today', () => {
    for (const mediaType of DEFAULT_MEDIA_TYPES) {
      const art = getCategoryArt(mediaType.key)
      expect(art.paths.length, `${mediaType.key} should have real art`).toBeGreaterThan(0)
    }
  })

  it('renders the fallback for an unrecognised key, without throwing', () => {
    expect(() => getCategoryArt('podcast')).not.toThrow()
    expect(getCategoryArt('podcast')).toEqual(FALLBACK_ART)
  })

  it('the fallback has no drawing but keeps the default tile-corner shape', () => {
    expect(FALLBACK_ART.paths).toEqual([])
    expect(FALLBACK_ART.box).toEqual({ w: 116, h: 116, r: -20, b: -22 })
    expect(FALLBACK_ART.viewBox).toBe('0 0 24 24')
  })

  it('gives the three wide drawings their own box and viewBox, not the default', () => {
    expect(getCategoryArt('documentary').box).toEqual({ w: 162, h: 97, r: -66, b: -12, flip: true })
    expect(getCategoryArt('game').box).toEqual({ w: 139, h: 97, r: -43, b: -12 })
    expect(getCategoryArt('youtube').box).toEqual({ w: 135, h: 102, r: -39, b: -14 })
  })

  it('every other category gets the default box, unflipped', () => {
    for (const key of ['movie', 'tv', 'animation', 'wrestling', 'mma', 'comic', 'book', 'music', 'mega']) {
      expect(getCategoryArt(key).box).toEqual({ w: 116, h: 116, r: -20, b: -22 })
    }
  })
})
