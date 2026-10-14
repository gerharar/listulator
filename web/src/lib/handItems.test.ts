import { describe, expect, it } from 'vitest'
import { parseHandItems } from './handItems.js'

describe('parseHandItems', () => {
  it('reads one item per line and trims each', () => {
    expect(parseHandItems('  Drunken Master  \nPolice Story').items).toEqual([
      { title: 'Drunken Master' },
      { title: 'Police Story' },
    ])
  })

  it('ignores blank lines', () => {
    const parsed = parseHandItems('\n\nA\n   \n\nB\n')

    expect(parsed.items.map((item) => item.title)).toEqual(['A', 'B'])
  })

  it('opens a group on a line ending in a colon', () => {
    const parsed = parseHandItems('Early years:\nA\nB\nLate years:\nC')

    expect(parsed.items).toEqual([
      { title: 'A', group: 'Early years' },
      { title: 'B', group: 'Early years' },
      { title: 'C', group: 'Late years' },
    ])
    expect(parsed.groups).toEqual(['Early years', 'Late years'])
  })

  it('opens a group on a markdown heading of any level', () => {
    const parsed = parseHandItems('# One\nA\n### Two\nB')

    expect(parsed.items).toEqual([
      { title: 'A', group: 'One' },
      { title: 'B', group: 'Two' },
    ])
  })

  it('leaves items before the first group ungrouped', () => {
    const parsed = parseHandItems('A\nSecond:\nB')

    expect(parsed.items).toEqual([{ title: 'A' }, { title: 'B', group: 'Second' }])
  })

  it('keeps an empty group in the group list, in textarea order', () => {
    // 10.16 turns these into list_groups rows, empty ones included.
    const parsed = parseHandItems('First:\nSecond:\nA')

    expect(parsed.groups).toEqual(['First', 'Second'])
    expect(parsed.items).toEqual([{ title: 'A', group: 'Second' }])
  })

  it('merges a group name that appears twice', () => {
    const parsed = parseHandItems('Same:\nA\nOther:\nB\nSame:\nC')

    expect(parsed.groups).toEqual(['Same', 'Other'])
    expect(parsed.items.map((item) => item.group)).toEqual(['Same', 'Other', 'Same'])
  })

  it('ignores a marker with no name', () => {
    const parsed = parseHandItems(':\n#\nA')

    expect(parsed.groups).toEqual([])
    expect(parsed.items).toEqual([{ title: 'A' }])
  })

  it('does not take a colon inside a title for a group', () => {
    expect(parseHandItems('Mission: Impossible').items).toEqual([{ title: 'Mission: Impossible' }])
  })

  it('returns nothing for empty text', () => {
    expect(parseHandItems('   \n  ')).toEqual({ items: [], groups: [] })
  })
})

describe('parseHandItems: a year in brackets at the end of a line (H-004, H-005)', () => {
  const items = (text: string) => parseHandItems(text).items

  it('takes an exact year off the end of the line and keeps the title without it', () => {
    expect(items('Fast Five (2011)')).toEqual([{ title: 'Fast Five', year: 2011 }])
  })

  it('takes a partial year with the digits it does not know', () => {
    expect(items('Rehearsal tape (198?)\nDemo (19??)')).toEqual([
      { title: 'Rehearsal tape', year: 1980, yearUnk: 1 },
      { title: 'Demo', year: 1900, yearUnk: 2 },
    ])
  })

  it('leaves a bracket in the middle of a title where it is', () => {
    expect(items('Spider-Man (1990) #57')).toEqual([{ title: 'Spider-Man (1990) #57' }])
  })

  it('keeps the group an item is under', () => {
    expect(items('The Fast and the Furious:\nFast Five (2011)')).toEqual([{ title: 'Fast Five', group: 'The Fast and the Furious', year: 2011 }])
  })

  it('does not take a year out of a group line: a colon or a # makes it a group, whatever is in it', () => {
    const parsed = parseHandItems('Phase 1 (1999):\nA\n# Phase 2 (2004)\nB')

    expect(parsed.groups).toEqual(['Phase 1 (1999)', 'Phase 2 (2004)'])
    expect(parsed.items).toEqual([
      { title: 'A', group: 'Phase 1 (1999)' },
      { title: 'B', group: 'Phase 2 (2004)' },
    ])
  })

  it.each(['Foo (0000)', 'Foo (3500)', 'Foo (31??)', 'Foo (1?)', 'Foo (19?4)', 'Foo (201)', '(2011)', 'Foo 2011'])(
    'leaves %j as it is: no year, or one the app does not hold (owner, 2026-10-14)',
    (line) => {
      expect(items(line)).toEqual([{ title: line }])
    },
  )

  it('trims the line first, as it always did', () => {
    expect(items('   Fast Five (2011)   ')).toEqual([{ title: 'Fast Five', year: 2011 }])
  })
})

