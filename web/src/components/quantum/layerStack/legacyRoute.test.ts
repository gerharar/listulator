import { describe, expect, it } from 'vitest'
import { parseLegacyPath } from './legacyRoute.js'

describe('parseLegacyPath', () => {
  it('the root path is Home', () => {
    expect(parseLegacyPath('/')).toEqual({ kind: 'home' })
    expect(parseLegacyPath('')).toEqual({ kind: 'home' })
  })

  it('/lists/:id is a list, with the id captured', () => {
    expect(parseLegacyPath('/lists/42')).toEqual({ kind: 'list', listId: '42' })
  })

  it('/lists/new is a new-list target, with an optional mediaType', () => {
    expect(parseLegacyPath('/lists/new')).toEqual({ kind: 'new-list', mediaType: undefined })
    expect(parseLegacyPath('/lists/new?mediaType=movie')).toEqual({
      kind: 'new-list',
      mediaType: 'movie',
    })
  })

  it('an unrecognised path falls back to Home rather than throwing', () => {
    expect(parseLegacyPath('/something/unexpected')).toEqual({ kind: 'home' })
  })
})
