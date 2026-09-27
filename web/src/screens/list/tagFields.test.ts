import { describe, expect, it } from 'vitest'
import type { FacetConvention } from '../../../../server/src/catalog/facets.js'
import { choiceOf, tagField, tagsDiffer, withChoice } from './tagFields.js'

const MUSIC: FacetConvention = [{ key: 'type', label: 'Type', values: ['Album', 'EP', 'Single', 'Live', 'Compilation'] }]
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
    expect(tagField(MUSIC)).toEqual({
      kind: 'choice',
      label: 'Type',
      values: ['Album', 'EP', 'Single', 'Live', 'Compilation'].map((tag) => ({ tag, label: tag })),
    })
    expect(tagField(MEGA)).toMatchObject({ kind: 'choice', label: 'Medium', values: [{ tag: 'movie', label: 'Movie' }, { tag: 'game', label: 'Game' }] })
  })

  it('gives nothing to an open-ended facet (a language) or a category without facets', () => {
    expect(tagField(BOOKS)).toBeNull()
    expect(tagField(undefined)).toBeNull()
    expect(tagField([])).toBeNull()
  })
})

describe('choiceOf / withChoice (U5)', () => {
  const field = tagField(MUSIC)
  if (field?.kind !== 'choice') throw new Error('Music has a choice')

  it('reads the item’s value whatever its case, in the facet’s own spelling', () => {
    expect(choiceOf(['live', 'Bonus'], field)).toEqual(['Live'])
    expect(choiceOf(null, field)).toEqual([])
  })

  it('reads every value when an item carries two, in the facet’s order', () => {
    expect(choiceOf(['Live', 'Album'], field)).toEqual(['Album', 'Live'])
  })

  it('replaces only the facet’s values, keeping every other tag', () => {
    expect(withChoice(['Bonus', 'album', 'Live'], field, 'EP')).toEqual(['Bonus', 'EP'])
    expect(withChoice(['Bonus', 'Album'], field, null)).toEqual(['Bonus'])
    expect(withChoice(null, field, 'Single')).toEqual(['Single'])
  })
})

describe('tagsDiffer (U5)', () => {
  it('ignores case, order and repeats, so an edit that did not touch the tags does not rewrite them', () => {
    expect(tagsDiffer(['PS4', 'WIN'], ['win', 'ps4'])).toBe(false)
    expect(tagsDiffer(null, [])).toBe(false)
    expect(tagsDiffer(['PS4'], ['PS4', 'WIN'])).toBe(true)
  })
})
