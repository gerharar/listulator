import { describe, expect, it } from 'vitest'
import type { MediaType } from '../../../lib/api.js'
import { keyNeeded, keySourceOf, tmdbKeyNeeded } from './keyNeeded.js'

function type(overrides: Partial<MediaType>): MediaType {
  return { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 120, searchAvailable: false, previewable: true, sourceName: 'TMDB', keySource: 'tmdb', ...overrides }
}

describe('keyNeeded: a free key would unlock the category’s own source (H-018)', () => {
  it('is true in the desktop app for a source that has a name and cannot be searched yet', () => {
    expect(keyNeeded(type({}), true)).toBe(true)
  })

  it('is false once the source can be searched, whatever the reason (a saved key, or a source that needs none)', () => {
    expect(keyNeeded(type({ searchAvailable: true }), true)).toBe(false)
  })

  it('is false for a category searched by hand, which has no source to unlock', () => {
    const byHand = type({})
    delete byHand.sourceName
    delete byHand.keySource

    expect(keyNeeded(byHand, true)).toBe(false)
  })

  it('is false for Mega, whose search is the library alone and never takes a key', () => {
    expect(keyNeeded(type({ searchScope: 'library', sourceName: 'List Vault' }), true)).toBe(false)
  })

  it('is false in the web build, where keys are set in the server’s environment, not by the person using it', () => {
    expect(keyNeeded(type({}), false)).toBe(false)
  })
})

describe('tmdbKeyNeeded: the first-run callout is about TMDB alone', () => {
  const igdb = type({ key: 'game', label: 'Games', sourceName: 'IGDB', keySource: 'igdb' })

  it('is true while any TMDB category cannot be searched, in the desktop app', () => {
    expect(tmdbKeyNeeded([type({}), igdb], true)).toBe(true)
  })

  it('is false once every TMDB category can be searched, whatever another source lacks', () => {
    expect(tmdbKeyNeeded([type({ searchAvailable: true }), igdb], true)).toBe(false)
  })

  it('is false when no category uses TMDB, and in the web build', () => {
    expect(tmdbKeyNeeded([igdb], true)).toBe(false)
    expect(tmdbKeyNeeded([type({})], false)).toBe(false)
  })
})

describe('keySourceOf: which key a category’s source takes, as the registry says', () => {
  it('reads the key source the registry names', () => {
    expect(keySourceOf(type({ keySource: 'tmdb' }))).toBe('tmdb')
    expect(keySourceOf(type({ sourceName: 'IGDB', keySource: 'igdb' }))).toBe('igdb')
    expect(keySourceOf(type({ sourceName: 'Comic Vine', keySource: 'comicVine' }))).toBe('comicVine')
    expect(keySourceOf(type({ sourceName: 'YouTube', keySource: 'youtube' }))).toBe('youtube')
  })

  it('is null for a source that takes no key, and for a category with none', () => {
    const wikipedia = type({ sourceName: 'Wikipedia' })
    delete wikipedia.keySource
    expect(keySourceOf(wikipedia)).toBeNull()
    const byHand = type({})
    delete byHand.sourceName
    delete byHand.keySource
    expect(keySourceOf(byHand)).toBeNull()
  })
})

describe('keyNeeded for a source that takes no key', () => {
  it('is false even when its source cannot be searched for another reason (an outage): there is no key to add', () => {
    const wikipedia = type({ sourceName: 'Wikipedia', searchAvailable: false })
    delete wikipedia.keySource

    expect(keyNeeded(wikipedia, true)).toBe(false)
    expect(tmdbKeyNeeded([wikipedia], true)).toBe(false)
  })
})
