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
