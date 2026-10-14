import { describe, expect, it } from 'vitest'
import {
  approximateDecade,
  filterYearInput,
  formatYear,
  NO_YEAR,
  parseYamlYear,
  parseYearText,
  splitTrailingYear,
  validYearPair,
  yearFieldText,
  yamlYearValue,
  yearTextProblem,
  yearSortKey,
  yearSpan,
  type ItemYear,
} from './years.js'

/**
 * H-004 / H-005: an item's year is a four-digit year, or one whose last one or two digits are unknown (`199?`, `19??`).
 * Stored as `year` = the earliest it can be (1990) and `yearUnk` = how many digits are unknown (0, 1, 2). The owner's
 * rulings (2026-10-14): a year outside 1 to 3000 is invalid like any other bad form; a quoted exact year is accepted
 * in a YAML file; a bracket with an out-of-range year stays in the title in Use Hands.
 */
const y = (year: number, yearUnk: 0 | 1 | 2 = 0): ItemYear => ({ year, yearUnk })

describe('filterYearInput: what a keystroke may leave in the field', () => {
  it.each([
    ['1994', '1994'],
    ['199?', '199?'],
    ['19??', '19??'],
    ['1?9x', '1?'],
    ['abc', ''],
    ['19999', '1999'],
    ['19??9', '19??'],
    ['1 9 9 4', '1994'],
    ['19-94', '1994'],
    ['', ''],
  ])('%j becomes %j', (typed, kept) => {
    expect(filterYearInput(typed)).toBe(kept)
  })

  it('keeps a leading ? so the field can say it is wrong, rather than swallowing it', () => {
    expect(filterYearInput('?')).toBe('?')
  })
})

describe('parseYearText', () => {
  it('reads the three valid forms', () => {
    expect(parseYearText('1994')).toEqual(y(1994))
    expect(parseYearText('199?')).toEqual(y(1990, 1))
    expect(parseYearText('19??')).toEqual(y(1900, 2))
  })

  it('reads empty as "no year", which is valid', () => {
    expect(parseYearText('')).toEqual(NO_YEAR)
    expect(parseYearText('   ')).toEqual(NO_YEAR)
  })

  it('ignores the spaces around it', () => {
    expect(parseYearText(' 1994 ')).toEqual(y(1994))
  })

  it.each(['1', '19', '199', '1?', '19?', '1???', '????', '?', '1??4', '19?4', '?994', '19a4', '199?x', '12345', '-199'])(
    'refuses %j: one to three digits, ? anywhere but the end, three unknown digits, anything else',
    (text) => {
      expect(parseYearText(text)).toBeUndefined()
    },
  )

  it.each(['0000', '3001', '3500', '9999', '31??', '000?'])('refuses %j: four characters, but outside the years the app holds', (text) => {
    expect(parseYearText(text)).toBeUndefined()
  })

  it('keeps the ends of the range: 0001 and 3000 are years, so are 001? and 30??', () => {
    expect(parseYearText('0001')).toEqual(y(1))
    expect(parseYearText('3000')).toEqual(y(3000))
    expect(parseYearText('30??')).toEqual(y(3000, 2))
    expect(parseYearText('0800')).toEqual(y(800))
  })
})

describe('yearTextProblem: why the field is wrong, so each reason can have its own words', () => {
  it('is null for empty and for every valid form', () => {
    for (const text of ['', ' ', '1994', '199?', '19??', '0800']) expect(yearTextProblem(text)).toBeNull()
  })

  it('says "form" for text that is not one of the three forms', () => {
    for (const text of ['1', '199', '1?', '19?4', '????', '?', 'abc', '12345', '1???']) expect(yearTextProblem(text)).toBe('form')
  })

  it('says "range" for a year of the right form that the app does not hold (owner, 2026-10-14)', () => {
    for (const text of ['0000', '3001', '3500', '9999', '31??', '000?']) expect(yearTextProblem(text)).toBe('range')
  })
})

describe('formatYear and yearFieldText', () => {
  it('writes an exact year as digits and a partial one with ?', () => {
    expect(formatYear(y(1994))).toBe('1994')
    expect(formatYear(y(1990, 1))).toBe('199?')
    expect(formatYear(y(1900, 2))).toBe('19??')
  })

  it('writes no year as nothing', () => {
    expect(formatYear(NO_YEAR)).toBe('')
    expect(yearFieldText(NO_YEAR)).toBe('')
  })

  it('shows a year below 1000 as it is in a row, and with its zero in the field, so the field reads back as the same year', () => {
    expect(formatYear(y(800))).toBe('800')
    expect(yearFieldText(y(800))).toBe('0800')
    expect(parseYearText(yearFieldText(y(800)))).toEqual(y(800))
  })

  it.each(['1994', '199?', '19??', '0800', '0010', '001?', ''])('round-trips %j through the field', (text) => {
    expect(yearFieldText(parseYearText(text)!)).toBe(text)
  })
})

describe('yearSortKey: the latest it can be, narrower first on a tie', () => {
  it('orders 1989 < 198? < 1990 < 1999 < 199? < 19?? < 2000 < no year', () => {
    const shuffled = [NO_YEAR, y(2000), y(1900, 2), y(1990, 1), y(1999), y(1990), y(1980, 1), y(1989)]

    const ordered = [...shuffled].sort((a, b) => yearSortKey(a) - yearSortKey(b)).map(formatYear)

    expect(ordered).toEqual(['1989', '198?', '1990', '1999', '199?', '19??', '2000', ''])
  })

  it('gives no year the last place', () => {
    expect(yearSortKey(NO_YEAR)).toBe(Number.POSITIVE_INFINITY)
  })

  it('puts an exact year before a partial one that ends the same year', () => {
    expect(yearSortKey(y(1999))).toBeLessThan(yearSortKey(y(1990, 1)))
  })
})

describe('yearSpan: the years of a group, for its header', () => {
  const span = (...years: ItemYear[]) => yearSpan(years)

  it('is the earliest to the latest, by the same key as the sort', () => {
    expect(span(y(2008), y(1990, 1), y(1999))).toEqual({ from: y(1999), to: y(2008) })
  })

  it('reaches into a partial year at either end', () => {
    expect(span(y(1990, 1), y(2008))).toEqual({ from: y(1990, 1), to: y(2008) })
    expect(span(y(1980, 1), y(1985))).toEqual({ from: y(1985), to: y(1980, 1) })
  })

  it('leaves out items with no year, and has none when none has one', () => {
    expect(span(NO_YEAR, y(2001), NO_YEAR)).toEqual({ from: y(2001), to: y(2001) })
    expect(span(NO_YEAR, NO_YEAR)).toBeNull()
    expect(span()).toBeNull()
  })
})

describe('approximateDecade: what a tooltip says for a partial year', () => {
  it('names the decade or the century', () => {
    expect(approximateDecade(y(1990, 1))).toBe('1990s')
    expect(approximateDecade(y(1900, 2))).toBe('1900s')
  })

  it('has nothing to say for an exact year, or none', () => {
    expect(approximateDecade(y(1994))).toBeNull()
    expect(approximateDecade(NO_YEAR)).toBeNull()
  })
})

describe('splitTrailingYear: Use Hands (a year in brackets at the end of a line)', () => {
  it('takes an exact year off the end of the line', () => {
    expect(splitTrailingYear('Fast Five (2011)')).toEqual({ title: 'Fast Five', year: y(2011) })
  })

  it('takes a partial year too', () => {
    expect(splitTrailingYear('Rehearsal tape (198?)')).toEqual({ title: 'Rehearsal tape', year: y(1980, 1) })
    expect(splitTrailingYear('Demo (19??)')).toEqual({ title: 'Demo', year: y(1900, 2) })
  })

  it('leaves a bracket in the middle of the title where it is', () => {
    expect(splitTrailingYear('Spider-Man (1990) #57')).toBeNull()
  })

  it('wants a title before the year, and a year of the right shape', () => {
    expect(splitTrailingYear('(2011)')).toBeNull()
    expect(splitTrailingYear(' (2011)')).toBeNull()
    expect(splitTrailingYear('Fast Five (20111)')).toBeNull()
    expect(splitTrailingYear('Fast Five (201)')).toBeNull()
    expect(splitTrailingYear('Fast Five (1?)')).toBeNull()
    expect(splitTrailingYear('Fast Five (19?4)')).toBeNull()
    expect(splitTrailingYear('Fast Five 2011')).toBeNull()
  })

  it('leaves a bracket whose year is outside the years the app holds in the title (owner, 2026-10-14)', () => {
    expect(splitTrailingYear('Foo (0000)')).toBeNull()
    expect(splitTrailingYear('Foo (3500)')).toBeNull()
    expect(splitTrailingYear('Foo (31??)')).toBeNull()
  })

  it('does not need a space before the bracket, and takes only the last bracket', () => {
    expect(splitTrailingYear('Fast Five(2011)')).toEqual({ title: 'Fast Five', year: y(2011) })
    expect(splitTrailingYear('Blade Runner (1982) (2049)')).toEqual({ title: 'Blade Runner (1982)', year: y(2049) })
  })
})

describe('parseYamlYear and yamlYearValue (a list file)', () => {
  it('reads a whole number in range, and the two partial forms as strings', () => {
    expect(parseYamlYear(1994)).toEqual(y(1994))
    expect(parseYamlYear('199?')).toEqual(y(1990, 1))
    expect(parseYamlYear('19??')).toEqual(y(1900, 2))
  })

  it('also reads an exact year in quotes (owner, 2026-10-14), when it is in range', () => {
    expect(parseYamlYear('1994')).toEqual(y(1994))
    expect(parseYamlYear('3500')).toBeUndefined()
  })

  it.each([1994.5, 0, 3001, -5, 'abc', '1?', '19?4', '199', ' 1994', '1994 ', '', '1e3', null, true, [], {}, Number.NaN])(
    'refuses %j',
    (value) => {
      expect(parseYamlYear(value)).toBeUndefined()
    },
  )

  it('writes an exact year as a number and a partial one as a string: what the file shows', () => {
    expect(yamlYearValue(y(1994))).toBe(1994)
    expect(yamlYearValue(y(1990, 1))).toBe('199?')
    expect(yamlYearValue(y(1900, 2))).toBe('19??')
  })

  it('reads back what it writes', () => {
    for (const year of [y(1994), y(1990, 1), y(1900, 2), y(1), y(3000)]) {
      expect(parseYamlYear(yamlYearValue(year))).toEqual(year)
    }
  })
})

describe('validYearPair: a year and its unknown digits, as an API or a file hands them over', () => {
  it('accepts an exact year, a partial one, and none', () => {
    expect(validYearPair(1994, 0)).toEqual(y(1994))
    expect(validYearPair(1990, 1)).toEqual(y(1990, 1))
    expect(validYearPair(1900, 2)).toEqual(y(1900, 2))
    expect(validYearPair(null, 0)).toEqual(NO_YEAR)
  })

  it('takes a missing yearUnk as 0 and a missing year as none', () => {
    expect(validYearPair(1994, undefined)).toEqual(y(1994))
    expect(validYearPair(undefined, undefined)).toEqual(NO_YEAR)
    expect(validYearPair(null, undefined)).toEqual(NO_YEAR)
  })

  it.each([
    [1994, 1],
    [1990, 2],
    [1994, 2],
    [1990, 3],
    [1990, -1],
    [1990, 1.5],
    [1990, '1'],
    [null, 1],
    [undefined, 2],
    [0, 0],
    [3001, 0],
    [3100, 2],
    [1994.5, 0],
    ['1994', 0],
    [Number.NaN, 0],
  ])('refuses year %j with %j unknown digits: a year must be a multiple of 10 to the power of the unknown digits, and in range', (year, unk) => {
    expect(validYearPair(year, unk)).toBeUndefined()
  })
})
