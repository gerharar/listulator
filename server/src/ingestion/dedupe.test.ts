import { describe, expect, it } from 'vitest'
import { dedupeByTitle } from './dedupe.js'
import type { MediaTypeCandidate } from './mediaTypes.js'

describe('dedupeByTitle', () => {
  it('leaves candidates with distinct titles untouched, in order', () => {
    const candidates: MediaTypeCandidate[] = [
      { title: 'Elantris', year: 2005 },
      { title: 'Mistborn', year: 2006 },
    ]

    expect(dedupeByTitle(candidates)).toEqual(candidates)
  })

  it('collapses a duplicate title to the earliest year, when both have one', () => {
    const earlier: MediaTypeCandidate = { title: 'Elantris', year: 2005 }
    const later: MediaTypeCandidate = { title: 'Elantris', year: 2025 }

    expect(dedupeByTitle([later, earlier])).toEqual([earlier])
    expect(dedupeByTitle([earlier, later])).toEqual([earlier])
  })

  it('matches titles case-insensitively and ignoring surrounding whitespace', () => {
    const first: MediaTypeCandidate = { title: '  Elantris ', year: 2005 }
    const second: MediaTypeCandidate = { title: 'ELANTRIS', year: 2025 }

    expect(dedupeByTitle([first, second])).toEqual([first])
  })

  it('keeps the first-seen candidate on a full tie (equal years)', () => {
    const first: MediaTypeCandidate = { title: 'Elantris', year: 2005, timeToConsumeMinutes: 100 }
    const second: MediaTypeCandidate = { title: 'Elantris', year: 2005, timeToConsumeMinutes: 200 }

    expect(dedupeByTitle([first, second])).toEqual([first])
  })

  it('keeps the first-seen candidate when neither has a year', () => {
    const first: MediaTypeCandidate = { title: 'Elantris' }
    const second: MediaTypeCandidate = { title: 'Elantris', timeToConsumeMinutes: 200 }

    expect(dedupeByTitle([first, second])).toEqual([first])
  })

  it('keeps the first-seen candidate when only one side has a year', () => {
    // The earliest-year rule only applies when *both* sides have one —
    // a single known year is not treated as automatically "earlier" than
    // unknown.
    const undated: MediaTypeCandidate = { title: 'Elantris' }
    const dated: MediaTypeCandidate = { title: 'Elantris', year: 2005 }

    expect(dedupeByTitle([undated, dated])).toEqual([undated])
    expect(dedupeByTitle([dated, undated])).toEqual([dated])
  })

  it('keeps the winning candidate whole, never merging fields from both', () => {
    const earlier: MediaTypeCandidate = { title: 'Elantris', year: 2005, timeToConsumeMinutes: 638 }
    const later: MediaTypeCandidate = {
      title: 'Elantris',
      year: 2025,
      timeToConsumeMinutes: 592,
      externalRef: 'edition:2025',
    }

    expect(dedupeByTitle([later, earlier])).toEqual([earlier])
  })

  it('preserves the duplicate title\'s first-seen position in the output', () => {
    const a: MediaTypeCandidate = { title: 'A' }
    const dupFirst: MediaTypeCandidate = { title: 'Dup', year: 2010 }
    const b: MediaTypeCandidate = { title: 'B' }
    const dupSecond: MediaTypeCandidate = { title: 'Dup', year: 2005 }

    expect(dedupeByTitle([a, dupFirst, b, dupSecond])).toEqual([a, dupSecond, b])
  })

  it('returns nothing for an empty list', () => {
    expect(dedupeByTitle([])).toEqual([])
  })
})
