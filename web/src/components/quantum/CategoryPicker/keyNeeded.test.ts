import { describe, expect, it } from 'vitest'
import type { MediaType } from '../../../lib/api.js'
import { keyNeeded } from './keyNeeded.js'

function type(overrides: Partial<MediaType>): MediaType {
  return { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 120, searchAvailable: false, previewable: true, sourceName: 'TMDB', ...overrides }
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

    expect(keyNeeded(byHand, true)).toBe(false)
  })

  it('is false for Mega, whose search is the library alone and never takes a key', () => {
    expect(keyNeeded(type({ searchScope: 'library', sourceName: 'List Vault' }), true)).toBe(false)
  })

  it('is false in the web build, where keys are set in the server’s environment, not by the person using it', () => {
    expect(keyNeeded(type({}), false)).toBe(false)
  })
})
