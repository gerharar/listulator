import { describe, expect, it } from 'vitest'
import type { ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import {
  buildEditPatch as build,
  durationFieldText,
  editProblems,
  invertPatch,
  minutesProblem,
  minutesSentence,
  titleProblem,
  yearProblem,
  yearSentence,
} from './itemActions.js'

const ITEM: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Glorious Purpose',
  orderIndex: 0,
  timeToConsumeMinutes: 51,
  timeToConsumeIsEstimated: false,
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
/** The category's default length, which an empty Duration means (H-006). */
const DEFAULT = 120
const buildEditPatch = (item: ListItem, draft: Parameters<typeof build>[1]) => build(item, draft, DEFAULT)

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

  it.each(['4.5', '0', '100000', 'abc', '1:61'])('is nothing for minutes of %j, which cannot be saved', (minutes) => {
    expect(buildEditPatch(ITEM, { ...same, title: 'Renamed', minutes })).toBeNull()
  })

  it('is nothing for a blank title', () => {
    expect(buildEditPatch(ITEM, { ...same, title: '   ' })).toBeNull()
  })

  it.each([
    ['1h 30m', 90],
    ['1:30', 90],
    ['90m', 90],
    ['2h', 120],
  ])('reads %j as %d minutes (H-007)', (minutes, expected) => {
    expect(buildEditPatch(ITEM, { ...same, minutes })).toEqual({ timeToConsumeMinutes: expected, timeToConsumeIsEstimated: false })
  })

  it('does not change anything for a time typed another way that is the same length', () => {
    expect(buildEditPatch({ ...ITEM, timeToConsumeMinutes: 90, timeToConsumeIsEstimated: false }, { ...same, minutes: '1h 30m' })).toBeNull()
  })

  describe('an empty duration is the category default, estimated (owner, 2026-10-15)', () => {
    it('sets the default and marks it estimated', () => {
      expect(buildEditPatch(ITEM, { ...same, minutes: '' })).toEqual({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
      expect(buildEditPatch(ITEM, { ...same, minutes: '   ' })).toEqual({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('also for an item that had a real length from its source', () => {
      const real = { ...ITEM, timeToConsumeMinutes: 142, timeToConsumeIsEstimated: false }

      expect(buildEditPatch(real, { ...same, minutes: '' })).toEqual({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('marks an item that already has the default length, typed, as an estimate', () => {
      const typed = { ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: false }

      expect(buildEditPatch(typed, { ...same, minutes: '' })).toEqual({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
    })

    it('is nothing for an item that is already the default estimate', () => {
      const estimate = { ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true }

      expect(buildEditPatch(estimate, { ...same, minutes: '' })).toBeNull()
    })
  })
})

describe('an estimated length: the Duration field opens empty (owner, 2026-10-15: "empty = default, different from category to category")', () => {
  const estimate = { ...ITEM, timeToConsumeMinutes: 90, timeToConsumeIsEstimated: true }

  it('opens with the number for a length that was given and with nothing for an estimate', () => {
    expect(durationFieldText(ITEM)).toBe('51')
    expect(durationFieldText(estimate)).toBe('')
    const pending: ListItem = { ...estimate, runtimePending: true }

    expect(durationFieldText(pending)).toBe('')
  })

  it('changes nothing when the field is left empty', () => {
    expect(buildEditPatch(estimate, { ...same, minutes: '' })).toBeNull()
    expect(buildEditPatch(estimate, { ...same, title: 'Renamed', minutes: '' })).toEqual({ title: 'Renamed' })
  })

  it('makes a typed length of it, estimate off', () => {
    expect(buildEditPatch(estimate, { ...same, minutes: '60' })).toEqual({ timeToConsumeMinutes: 60, timeToConsumeIsEstimated: false })
  })

  it('makes it a typed length even when the number is the estimate’s own: the person confirmed it', () => {
    expect(buildEditPatch(estimate, { ...same, minutes: '90' })).toEqual({ timeToConsumeIsEstimated: false })
    expect(buildEditPatch(estimate, { ...same, minutes: '1h 30m' })).toEqual({ timeToConsumeIsEstimated: false })
  })

  it('checks what was typed over an estimate, since the field was empty', () => {
    expect(editProblems(estimate, { ...same, minutes: 'abc' }).minutes).toBe('form')
    expect(buildEditPatch(estimate, { ...same, minutes: '0' })).toBeNull()
  })

  it('gives the category default back, as an estimate, to a length that was typed and then cleared', () => {
    expect(buildEditPatch(ITEM, { ...same, minutes: '' })).toEqual({ timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })
  })
})

describe('the problem of one field, for the window to check each as it is left (H-006)', () => {
  it('titleProblem: an empty title or spaces only', () => {
    expect(titleProblem('')).toBe('empty')
    expect(titleProblem('   ')).toBe('empty')
    expect(titleProblem('Heat')).toBeNull()
  })

  it('minutesProblem: only what was changed, and empty is no problem', () => {
    expect(minutesProblem(ITEM, '')).toBeNull()
    expect(minutesProblem(ITEM, '51')).toBeNull()
    expect(minutesProblem(ITEM, 'abc')).toBe('form')
    expect(minutesProblem(ITEM, '0')).toBe('zero')
    expect(minutesProblem(ITEM, '100000')).toBe('range')
    expect(minutesProblem({ ...ITEM, timeToConsumeMinutes: 0 }, '0')).toBeNull()
  })

  it('yearProblem: only what was changed, and empty is no problem', () => {
    expect(yearProblem(ITEM, '2021')).toBeNull()
    expect(yearProblem(ITEM, '')).toBeNull()
    expect(yearProblem(ITEM, '19')).toBe('form')
    expect(yearProblem(ITEM, '0999')).toBe('early')
    expect(yearProblem(ITEM, '3500')).toBe('late')
    expect(yearProblem({ ...ITEM, year: 800 }, '800')).toBeNull()
  })
})

describe('editProblems: what is wrong with the draft, for the window to say (H-006)', () => {
  it('is nothing wrong for a draft that is good, and for the empty fields that mean something', () => {
    expect(editProblems(ITEM, { ...same, year: '2021' })).toEqual({ title: null, minutes: null, year: null })
    expect(editProblems(ITEM, { ...same, minutes: '', year: '' })).toEqual({ title: null, minutes: null, year: null })
  })

  it('says an empty title is wrong', () => {
    expect(editProblems(ITEM, { ...same, title: '  ' }).title).toBe('empty')
  })

  it.each([
    ['abc', 'form'],
    ['1.5h', 'form'],
    ['0', 'zero'],
    ['0m', 'zero'],
    ['100000', 'range'],
    ['1667h', 'range'],
  ])('says minutes of %j are wrong: %s', (minutes, problem) => {
    expect(editProblems(ITEM, { ...same, minutes }).minutes).toBe(problem)
  })

  it.each([
    ['199', 'form'],
    ['19?4', 'form'],
    ['0999', 'early'],
    ['3500', 'late'],
    ['31??', 'late'],
  ])('says a year of %j is wrong: %s', (year, problem) => {
    expect(editProblems(ITEM, { ...same, year }).year).toBe(problem)
  })

  it('reports every field that is wrong at once', () => {
    expect(editProblems(ITEM, { title: '', minutes: 'x', group: '', year: '3500' })).toEqual({ title: 'empty', minutes: 'form', year: 'late' })
  })

  it('does not check a year or a length the person did not change, so an old stored value never blocks another edit', () => {
    const old = { ...ITEM, year: 800, timeToConsumeMinutes: 0 }

    expect(editProblems(old, { ...same, minutes: '0', year: '800' })).toEqual({ title: null, minutes: null, year: null })
    expect(buildEditPatch(old, { ...same, title: 'Renamed', minutes: '0', year: '800' })).toEqual({ title: 'Renamed' })
  })

  it('checks it again as soon as it is changed', () => {
    const old = { ...ITEM, year: 800 }

    expect(editProblems(old, { ...same, year: '0801' }).year).toBe('early')
  })
})

describe('the sentences for what editProblems finds (H-004, H-006, H-007)', () => {
  const text = copy.quantum.list.itemActions

  it('names the year problems: the form, too early, and too far ahead with what was typed', () => {
    expect(yearSentence(text, 'form', '19')).toBe(text.yearForm)
    expect(yearSentence(text, 'early', '0999')).toBe(text.yearTooEarly)
    expect(yearSentence(text, 'late', '3500')).toBe(text.yearTooLate('3500'))
  })

  it('repeats the year without the spaces around it', () => {
    expect(yearSentence(text, 'late', ' 3500 ')).toBe(text.yearTooLate('3500'))
  })

  it('names the duration problems: the form, nothing, and over the limit, with the category default for nothing', () => {
    expect(minutesSentence(text, 'form', 120)).toBe(text.minutesForm)
    expect(minutesSentence(text, 'zero', 120)).toBe(text.minutesZero(120))
    expect(minutesSentence(text, 'zero', 30)).toBe(text.minutesZero(30))
    expect(minutesSentence(text, 'range', 120)).toBe(text.minutesRange)
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
    const estimate = { ...ITEM, timeToConsumeIsEstimated: true }

    expect(invertPatch(estimate, { timeToConsumeMinutes: 60, timeToConsumeIsEstimated: false })).toEqual({
      timeToConsumeMinutes: 51,
      timeToConsumeIsEstimated: true,
    })
  })

  it('puts the estimate back when only the flag changed: a typed length with the estimate’s own number', () => {
    const estimate = { ...ITEM, timeToConsumeMinutes: 90, timeToConsumeIsEstimated: true }

    expect(invertPatch(estimate, { timeToConsumeIsEstimated: false })).toEqual({ timeToConsumeIsEstimated: true })
  })

  it('puts a typed length back, estimate off, after it was cleared to the default', () => {
    expect(invertPatch(ITEM, { timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true })).toEqual({
      timeToConsumeMinutes: 51,
      timeToConsumeIsEstimated: false,
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
