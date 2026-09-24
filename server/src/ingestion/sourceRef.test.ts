import { describe, expect, it } from 'vitest'
import { refForAdapter } from './sourceRef.js'

describe('refForAdapter', () => {
  it('leaves the ref alone when no option was sent', () => {
    expect(refForAdapter('author:OL1A', {})).toBe('author:OL1A')
  })

  it('folds a book language filter into the ref, so a refresh replays it', () => {
    expect(refForAdapter('author:OL1A', { language: 'eng' })).toBe('author:OL1A:eng')
  })

  it("marks 'include unknown' on the ref only alongside a specific language", () => {
    expect(refForAdapter('author:OL1A', { language: 'eng', includeUnknown: true })).toBe(
      'author:OL1A:eng:unknown',
    )
    expect(refForAdapter('author:OL1A', { includeUnknown: true })).toBe('author:OL1A')
  })

  it("treats language 'all' as no filter", () => {
    expect(refForAdapter('author:OL1A', { language: 'all' })).toBe('author:OL1A')
  })

  it('defaults to EPs and singles once any music toggle is sent', () => {
    expect(refForAdapter('artist-1', { includeLive: false })).toBe('artist-1:ep,single')
  })

  it('adds live and compilation only when asked for', () => {
    expect(
      refForAdapter('artist-1', { includeEp: true, includeSingle: false, includeLive: true }),
    ).toBe('artist-1:ep,live')
    expect(refForAdapter('artist-1', { includeCompilation: true })).toBe(
      'artist-1:ep,single,compilation',
    )
  })

  it('can drop every optional type, leaving an empty facet list', () => {
    expect(refForAdapter('artist-1', { includeEp: false, includeSingle: false })).toBe('artist-1:')
  })

  it('prefers the language filter when both kinds are somehow sent', () => {
    expect(refForAdapter('x', { language: 'eng', includeLive: true })).toBe('x:eng')
  })
})
