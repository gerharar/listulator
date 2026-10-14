import { describe, expect, it } from 'vitest'
import { durationTextProblem, parseDurationText } from './durations.js'

/**
 * H-007 (owner, 2026-10-15): the Duration field of the Edit window and the Minutes field of the Add row take minutes,
 * hours and minutes, or a clock form, and keep whole minutes. One module for the server's tests, the desktop and the
 * screens, as `years.ts` is for the year.
 */
describe('parseDurationText: the forms the field takes', () => {
  it.each([
    ['95', 95],
    ['1', 1],
    ['045', 45],
    ['99999', 99_999],
    ['1h 35m', 95],
    ['1h35m', 95],
    ['1h', 60],
    ['2h', 120],
    ['45m', 45],
    ['45 min', 45],
    ['1h 35 min', 95],
    ['1h35min', 95],
    ['1:35', 95],
    ['0:45', 45],
    ['12:00', 720],
    ['1:00', 60],
    ['1:59', 119],
  ])('reads %j as %d minutes', (text, minutes) => {
    expect(parseDurationText(text)).toBe(minutes)
  })

  it('ignores case and the spaces around and inside it', () => {
    expect(parseDurationText('  1H 35M ')).toBe(95)
    expect(parseDurationText('45 MIN')).toBe(45)
    expect(parseDurationText('  95  ')).toBe(95)
    expect(parseDurationText('1 h 35 m')).toBe(95)
    expect(parseDurationText(' 1:35 ')).toBe(95)
  })

  it('accepts minutes above 59 in the words form, only the clock form limits them: 1h 61m is 121', () => {
    expect(parseDurationText('1h 61m')).toBe(121)
    expect(parseDurationText('0h 90m')).toBe(90)
    expect(parseDurationText('90m')).toBe(90)
  })

  it('reads empty (and spaces only) as null: no length typed, the category default applies (owner, 2026-10-15)', () => {
    expect(parseDurationText('')).toBeNull()
    expect(parseDurationText('   ')).toBeNull()
  })

  it.each([
    'abc',
    '1.5h',
    '1.5',
    '1,5',
    '-5',
    '+5',
    '1:61',
    '1:60',
    '1:5',
    '1:350',
    ':30',
    '1:',
    '1:30:00',
    'h',
    'm',
    '1h m',
    '35m 1h',
    '1m 1m',
    '1h 1h',
    '1h35',
    '1 35',
    '95 minutes',
    '2 hours',
    '1e3',
    '0x10',
    '９５',
    '1h-5m',
  ])('refuses %j: not minutes, hours and minutes, or a clock form', (text) => {
    expect(parseDurationText(text)).toBeUndefined()
  })

  it.each(['0', '00', '0m', '0h', '0h 0m', '0:00', '0:0', '0 min'])('refuses %j: nothing is a length of 0', (text) => {
    expect(parseDurationText(text)).toBeUndefined()
  })

  it.each(['100000', '1667h', '1666h 40m', '1666:40', '9999999:00', '999999999999', '1'.repeat(400)])('refuses %j: over 99,999 minutes', (text) => {
    expect(parseDurationText(text)).toBeUndefined()
  })

  it('keeps the ends: 1 minute and 99,999 minutes in each form', () => {
    expect(parseDurationText('1')).toBe(1)
    expect(parseDurationText('99999')).toBe(99_999)
    expect(parseDurationText('99999m')).toBe(99_999)
    expect(parseDurationText('1666h 39m')).toBe(99_999)
    expect(parseDurationText('1666:39')).toBe(99_999)
    expect(parseDurationText('1666h')).toBe(99_960)
  })
})

describe('durationTextProblem: why the field is wrong, so each reason has its own sentence (H-006)', () => {
  it('is null for empty and for every form that reads', () => {
    for (const text of ['', ' ', '95', '1h 35m', '1h', '45 min', '1:35', '1h 61m']) expect(durationTextProblem(text)).toBeNull()
  })

  it('says "zero" for a length of nothing: "0 isn\'t a duration. Leave it empty to use the default"', () => {
    for (const text of ['0', '00', '0m', '0h 0m', '0:00']) expect(durationTextProblem(text)).toBe('zero')
  })

  it('says "range" for a length over 99,999 minutes', () => {
    for (const text of ['100000', '1667h', '1666h 40m', '9999999:00', '999999999999', '1'.repeat(400)]) expect(durationTextProblem(text)).toBe('range')
  })

  it('says "form" for everything else: "Use minutes (95), hours and minutes (1h 35m) or 1:35"', () => {
    for (const text of ['abc', '1.5h', '1:61', '-5', '1h35', '95 minutes', '1:5', ':30', '1e3']) expect(durationTextProblem(text)).toBe('form')
  })

  it('agrees with parseDurationText: a text reads exactly when it has no problem', () => {
    for (const text of ['', '95', '0', '100000', 'abc', '1:61', '1h 35m', '1666h 40m']) {
      expect(parseDurationText(text) !== undefined).toBe(durationTextProblem(text) === null)
    }
  })
})
