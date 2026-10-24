import { describe, expect, it } from 'vitest'
import { KEY_FIELDS, pasteSentence } from './keySources.js'

/** The key fields of each source, and the sentence that says which of them to paste first: one place for Settings' rows and the key card. */

describe('KEY_FIELDS', () => {
  it('names the saved settings that make up each source’s key; IGDB needs an ID and a secret', () => {
    expect(Object.fromEntries(KEY_FIELDS.map((source) => [source.id, source.fields]))).toEqual({
      tmdb: ['tmdbApiKey'],
      igdb: ['igdbClientId', 'igdbClientSecret'],
      comicVine: ['comicVineApiKey'],
      youtube: ['youtubeApiKey'],
    })
  })
})

describe('pasteSentence', () => {
  it('says "the key" for a source with one field', () => {
    expect(pasteSentence(['tmdbApiKey'], ['tmdbApiKey'])).toBe('Paste the key first')
  })

  it('says both when both of two fields are empty', () => {
    expect(pasteSentence(['igdbClientId', 'igdbClientSecret'], ['igdbClientId', 'igdbClientSecret'])).toBe('Paste the Client ID and Client Secret first')
  })

  it('names the one that is empty: the first of two, or the second', () => {
    expect(pasteSentence(['igdbClientId', 'igdbClientSecret'], ['igdbClientId'])).toBe('Paste the Client ID first')
    expect(pasteSentence(['igdbClientId', 'igdbClientSecret'], ['igdbClientSecret'])).toBe('Paste the Client Secret first')
  })
})
