import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_MAX_LENGTH,
  LIST_FILE_MAX_CHARS,
  MAX_LIST_ITEMS,
  MINUTES_RANGE,
  NAME_MAX_LENGTH,
  TAG_MAX_LENGTH,
  TAGS_MAX,
  validMinutes,
  validYear,
  YEAR_RANGE,
} from './limits.js'

/**
 * The numbers a list item may carry, wherever it came from (security review, Phase 19, SR-019): a list file, a library
 * list, a connector's answer, the runtime fill. A value outside them is never written to the database; one rule, so
 * the paths cannot disagree.
 */
describe('validMinutes', () => {
  it.each([1, 2, 90, 109, 1440, 100_000])('accepts %d', (value) => {
    expect(validMinutes(value)).toBe(value)
  })

  it.each([
    0,
    -1,
    -5,
    1.5,
    90.25,
    100_001,
    1e308,
    -1e308,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    '90',
    '',
    null,
    undefined,
    true,
    {},
    [90],
  ])('refuses %j', (value) => {
    expect(validMinutes(value)).toBeUndefined()
  })

  it('has the range the library guard test has always held its lists to', () => {
    expect(MINUTES_RANGE).toEqual([1, 100_000])
  })
})

describe('validYear', () => {
  it.each([1, 476, 1605, 1962, 2024, 9999])('accepts %d (a year as a person writes it, old books included)', (value) => {
    expect(validYear(value)).toBe(value)
  })

  it.each([0, -1, -800, 10_000, 2000.5, 1e308, Number.NaN, Number.POSITIVE_INFINITY, '1999', null, undefined, false, {}])('refuses %j', (value) => {
    expect(validYear(value)).toBeUndefined()
  })

  it('is a whole four-digit year at most', () => {
    expect(YEAR_RANGE).toEqual([1, 9999])
  })
})

describe('the sizes a list may have', () => {
  it('are the ones the library guard test has held its lists to, with the parser now holding every file to them', () => {
    expect([NAME_MAX_LENGTH, DESCRIPTION_MAX_LENGTH, TAGS_MAX, TAG_MAX_LENGTH, MAX_LIST_ITEMS]).toEqual([255, 1_000, 20, 64, 10_000])
    expect(LIST_FILE_MAX_CHARS).toBe(4 * 1024 * 1024)
  })
})
