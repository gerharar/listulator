import { describe, expect, it } from 'vitest'
import { newListPath, parseLayerPath } from './layerPath.js'

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

  it('/lists/new can also carry a search to run and a result to open (Open in Mega, task 14.1)', () => {
    const target = parseLayerPath(
      '/lists/new?mediaType=mega&q=breaking%20bad&open=canonical%3Alists%2Fmega%2Fbreaking-bad-all.yaml',
    )

    expect(target).toEqual({
      kind: 'new-list',
      mediaType: 'mega',
      query: 'breaking bad',
      openRef: 'canonical:lists/mega/breaking-bad-all.yaml',
    })
  })

  it('has no query or open ref when they are missing or empty', () => {
    for (const path of ['/lists/new?mediaType=mega', '/lists/new?mediaType=mega&q=&open=']) {
      const target = parseLayerPath(path)

      expect(target.kind === 'new-list' && target.query).toBeUndefined()
      expect(target.kind === 'new-list' && target.openRef).toBeUndefined()
    }
  })
})

describe('newListPath', () => {
  it('is what the category picker has always pushed when there is only a category', () => {
    expect(newListPath({ mediaType: 'tv' })).toBe('/lists/new?mediaType=tv')
  })

  it('round-trips a search and a ref with spaces, colons, slashes, ampersands and hashes', () => {
    const query = 'Rick & Morty: 50% #1 / "special"'
    const openRef = 'canonical:lists/mega/a b&c.yaml'

    const target = parseLayerPath(newListPath({ mediaType: 'mega', query, openRef }))

    expect(target).toEqual({ kind: 'new-list', mediaType: 'mega', query, openRef })
  })

  it('leaves out what it was not given', () => {
    expect(newListPath({ mediaType: 'mega', query: 'lost' })).toBe('/lists/new?mediaType=mega&q=lost')
  })
})

