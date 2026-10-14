import { describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { buildEditPatch, invertPatch } from './itemActions.js'

const ITEM: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Glorious Purpose',
  orderIndex: 0,
  timeToConsumeMinutes: 51,
  timeToConsumeIsEstimated: true,
  consumedAt: null,
  source: 'import',
  year: 2021,
  group: 'Season 1',
  tags: null,
  notes: null,
  yearUnk: 0,
  isNew: false,
}

const same = { title: 'Glorious Purpose', minutes: '51', group: 'Season 1' }

describe('buildEditPatch', () => {
  it('is nothing when nothing changed', () => {
    expect(buildEditPatch(ITEM, same)).toBeNull()
  })

  it('carries only what changed', () => {
    expect(buildEditPatch(ITEM, { ...same, title: 'Renamed' })).toEqual({ title: 'Renamed' })
    expect(buildEditPatch(ITEM, { ...same, group: 'Season 2' })).toEqual({ group: 'Season 2' })
  })

  it('trims the title and the group, and ignores a change that is only whitespace', () => {
    expect(buildEditPatch(ITEM, { ...same, title: '  Glorious Purpose  ' })).toBeNull()
    expect(buildEditPatch(ITEM, { ...same, group: ' Season 2 ' })).toEqual({ group: 'Season 2' })
  })

  it('a minutes value you typed is no longer an estimate', () => {
    expect(buildEditPatch(ITEM, { ...same, minutes: '60' })).toEqual({
      timeToConsumeMinutes: 60,
      timeToConsumeIsEstimated: false,
    })
  })

  it('leaves the estimate flag alone when the minutes are the same', () => {
    expect(buildEditPatch(ITEM, { ...same, title: 'X' })).not.toHaveProperty('timeToConsumeIsEstimated')
  })

  it('an empty group means leaving the group', () => {
    expect(buildEditPatch(ITEM, { ...same, group: '' })).toEqual({ group: null })
    expect(buildEditPatch({ ...ITEM, group: null }, { ...same, group: '' })).toBeNull()
  })

  it('is nothing for a blank title or minutes that are not a whole number', () => {
    expect(buildEditPatch(ITEM, { ...same, title: '   ' })).toBeNull()
    expect(buildEditPatch(ITEM, { ...same, minutes: '4.5' })).toBeNull()
    expect(buildEditPatch(ITEM, { ...same, minutes: '' })).toBeNull()
  })
})

describe('invertPatch', () => {
  it('puts back each field the patch changed, and only those', () => {
    expect(invertPatch(ITEM, { title: 'Renamed', group: 'Season 2' })).toEqual({
      title: 'Glorious Purpose',
      group: 'Season 1',
    })
  })

  it('puts back the minutes and whether they were an estimate', () => {
    expect(invertPatch(ITEM, { timeToConsumeMinutes: 60, timeToConsumeIsEstimated: false })).toEqual({
      timeToConsumeMinutes: 51,
      timeToConsumeIsEstimated: true,
    })
  })

  it('puts back "no group" as null', () => {
    expect(invertPatch({ ...ITEM, group: null }, { group: 'Season 2' })).toEqual({ group: null })
  })
})

describe('tags in an edit (U5)', () => {
  const draft = { title: ITEM.title, minutes: String(ITEM.timeToConsumeMinutes), group: ITEM.group ?? '' }

  it('patches the tags only when the draft carries them; none left clears them', () => {
    expect(buildEditPatch(ITEM, draft)).toBeNull()
    expect(buildEditPatch(ITEM, { ...draft, tags: ['PS4'] })).toEqual({ tags: ['PS4'] })
    expect(buildEditPatch(ITEM, { ...draft, tags: [] })).toEqual({ tags: null })
  })

  it('undoes a tag change back to the tags the item had, or none', () => {
    expect(invertPatch({ ...ITEM, tags: ['pc', 'PS3'] }, { tags: ['WIN'] })).toEqual({ tags: ['pc', 'PS3'] })
    expect(invertPatch({ ...ITEM, tags: null }, { tags: ['WIN'] })).toEqual({ tags: null })
  })
})

describe('buildEditPatch: the year (H-004, H-005)', () => {
  const partial = { ...ITEM, year: 1990, yearUnk: 1 }
  const none = { ...ITEM, year: null }

  it('leaves the year alone when the draft carries none, or the same one', () => {
    expect(buildEditPatch(ITEM, { ...same, year: '2021' })).toBeNull()
    expect(buildEditPatch(partial, { ...same, year: '199?' })).toBeNull()
    expect(buildEditPatch(none, { ...same, year: '' })).toBeNull()
  })

  it('carries an exact year with no unknown digits', () => {
    expect(buildEditPatch(ITEM, { ...same, year: '1994' })).toEqual({ year: 1994, yearUnk: 0 })
  })

  it('carries a partial year as the earliest it can be and how many digits are unknown', () => {
    expect(buildEditPatch(ITEM, { ...same, year: '199?' })).toEqual({ year: 1990, yearUnk: 1 })
    expect(buildEditPatch(ITEM, { ...same, year: '19??' })).toEqual({ year: 1900, yearUnk: 2 })
  })

  it('sees 1990 and 199? as different years', () => {
    expect(buildEditPatch(partial, { ...same, year: '1990' })).toEqual({ year: 1990, yearUnk: 0 })
    expect(buildEditPatch(ITEM, { ...same, year: '2020' })).toEqual({ year: 2020, yearUnk: 0 })
  })

  it('clears the year when the field is emptied', () => {
    expect(buildEditPatch(ITEM, { ...same, year: '' })).toEqual({ year: null, yearUnk: 0 })
    expect(buildEditPatch(partial, { ...same, year: '  ' })).toEqual({ year: null, yearUnk: 0 })
  })

  it.each(['1', '199', '1?', '19?4', '????', '3500', '0000', '31??'])('cannot be saved with a year of %j: nothing', (year) => {
    expect(buildEditPatch(ITEM, { ...same, title: 'Renamed', year })).toBeNull()
  })

  it('sends the year with the other changes in one patch', () => {
    expect(buildEditPatch(ITEM, { ...same, title: 'Renamed', year: '199?' })).toEqual({ title: 'Renamed', year: 1990, yearUnk: 1 })
  })
})

describe('invertPatch: the year (H-004, H-005)', () => {
  it('puts an exact year, a partial one, and none back as they were', () => {
    expect(invertPatch(ITEM, { year: 1994, yearUnk: 0 })).toEqual({ year: 2021, yearUnk: 0 })
    expect(invertPatch({ ...ITEM, year: 1990, yearUnk: 1 }, { year: 1990, yearUnk: 0 })).toEqual({ year: 1990, yearUnk: 1 })
    expect(invertPatch({ ...ITEM, year: null }, { year: 1994, yearUnk: 0 })).toEqual({ year: null, yearUnk: 0 })
  })

  it('says nothing about the year when the patch did not touch it', () => {
    expect(invertPatch(ITEM, { title: 'Renamed' })).toEqual({ title: 'Glorious Purpose' })
  })
})
