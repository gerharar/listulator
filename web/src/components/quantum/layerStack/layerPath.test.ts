import { describe, expect, it } from 'vitest'
import { parseLayerPath } from './layerPath.js'

describe('parseLayerPath', () => {
  it('the root path is Home', () => {
    expect(parseLayerPath('/')).toEqual({ kind: 'home' })
    expect(parseLayerPath('')).toEqual({ kind: 'home' })
  })

  it('/lists/:id is a list, with the id captured', () => {
    expect(parseLayerPath('/lists/42')).toEqual({ kind: 'list', listId: '42' })
  })

  it('/lists/new is a new-list target, with an optional mediaType', () => {
    expect(parseLayerPath('/lists/new')).toEqual({ kind: 'new-list', mediaType: undefined })
    expect(parseLayerPath('/lists/new?mediaType=movie')).toEqual({
      kind: 'new-list',
      mediaType: 'movie',
    })
  })

  it('/lists/preview carries its source in the query string', () => {
    const target = parseLayerPath('/lists/preview?mediaType=tv&externalRef=tmdb%3A1&title=Lost')

    expect(target.kind).toBe('preview')
    expect(target.kind === 'preview' && target.params.get('externalRef')).toBe('tmdb:1')
  })

  it('an unrecognised path falls back to Home rather than throwing', () => {
    expect(parseLayerPath('/something/unexpected')).toEqual({ kind: 'home' })
  })
})
