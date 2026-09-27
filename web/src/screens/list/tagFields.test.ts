import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../server/src/catalog/facets.js'
import { readChoice, tagField, tagsDiffer, writeChoice } from './tagFields.js'

// Music as the registry declares it (owner, 2026-09-27).
const MUSIC: FacetConvention = [
  {
    key: 'type',
    label: 'Type',
    keepOrder: true,
    prevails: 'Compilation',
    values: ['Album', { tag: 'Mini', label: 'Mini', aliases: ['EP', 'Single'] }, { tag: 'Compilation', label: 'Compilation', short: 'Comp', aliases: ['Comp'] }],
  },
  { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
]
const MEGA: FacetConvention = [
  { key: 'type', label: 'Medium', values: [{ tag: 'movie', label: 'Movie' }, { tag: 'game', label: 'Game' }] },
]
const GAMES: FacetConvention = [{ key: 'platform', label: 'Platform' }]
const BOOKS: FacetConvention = [{ key: 'language', label: 'Language', noValue: ['Unknown'] }]

describe('tagField (U5)', () => {
  it('gives Games the platform panel', () => {
    expect(tagField(GAMES)?.kind).toBe('platform')
  })

  it('gives a category with a fixed set of values a choice of them, labelled as the facet is', () => {
    expect(tagField(MUSIC)).toMatchObject({
      kind: 'choice',
      label: 'Type',
      keepOrder: true,
      values: [
        { tag: 'Album', label: 'Album' },
        { tag: 'Mini', label: 'Mini' },
        { tag: 'Compilation', label: 'Compilation' },
      ],
      flags: [{ tag: 'Live', label: 'Live' }],
    })
    expect(tagField(MEGA)).toMatchObject({
      kind: 'choice',
      label: 'Medium',
      keepOrder: false,
      values: [{ tag: 'movie', label: 'Movie' }, { tag: 'game', label: 'Game' }],
      flags: [],
    })
  })

  it('gives nothing to an open-ended facet (a language) or a category without facets', () => {
    expect(tagField(BOOKS)).toBeNull()
    expect(tagField(undefined)).toBeNull()
    expect(tagField([])).toBeNull()
  })
})

describe('readChoice / writeChoice', () => {
  const music = tagField(MUSIC)
  const mega = tagField(MEGA)
  if (music?.kind !== 'choice' || mega?.kind !== 'choice') throw new Error('Music and Mega have a choice')

  it('reads the main value and the flags in the facet’s own spelling, whatever the case', () => {
    expect(readChoice(['live', 'Bonus', 'album'], music)).toEqual({ main: 'Album', flags: ['Live'] })
    expect(readChoice(null, music)).toEqual({ main: null, flags: [] })
    expect(readChoice(['Live'], music)).toEqual({ main: null, flags: ['Live'] })
  })

  it('reads EP and Single as Mini, and a Compilation over an Album', () => {
    expect(readChoice(['EP'], music)).toEqual({ main: 'Mini', flags: [] })
    expect(readChoice(['Single', 'Live'], music)).toEqual({ main: 'Mini', flags: ['Live'] })
    expect(readChoice(['Album', 'Compilation'], music)).toEqual({ main: 'Compilation', flags: [] })
  })

  it('replaces only the facet’s tags, keeping every other tag', () => {
    expect(writeChoice(['Split', 'EP'], music, { main: 'Album', flags: [] })).toEqual(['Split', 'Album'])
    expect(writeChoice(['Bonus', 'Album'], music, { main: null, flags: [] })).toEqual(['Bonus'])
    expect(writeChoice(null, music, { main: 'Mini', flags: ['Live'] })).toEqual(['Mini', 'Live'])
  })

  it('keeps the source’s own tags while the main value stays (owner: EP and Single are worth keeping)', () => {
    expect(writeChoice(['EP'], music, { main: 'Mini', flags: ['Live'] })).toEqual(['EP', 'Live'])
    expect(writeChoice(['Album', 'Compilation', 'Live'], music, { main: 'Compilation', flags: [] })).toEqual([
      'Album',
      'Compilation',
    ])
    expect(writeChoice(['EP', 'live'], music, { main: 'Mini', flags: ['Live'] })).toEqual(['EP', 'live'])
  })

  it('writes the value’s own tag for a single-pick category', () => {
    expect(writeChoice(['movie'], mega, { main: 'game', flags: [] })).toEqual(['game'])
  })
})

describe('tagsDiffer (U5)', () => {
  it('ignores case, order and repeats, so an edit that did not touch the tags does not rewrite them', () => {
    expect(tagsDiffer(['PS4', 'WIN'], ['win', 'ps4'])).toBe(false)
    expect(tagsDiffer(null, [])).toBe(false)
    expect(tagsDiffer(['PS4'], ['PS4', 'WIN'])).toBe(true)
  })
})
