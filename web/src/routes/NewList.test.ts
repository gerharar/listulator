import { describe, expect, it } from 'vitest'
import { parseItemTitles } from './NewList.js'

describe('parseItemTitles', () => {
  it('takes one item per line', () => {
    expect(parseItemTitles('Drunken Master\nPolice Story\nProject A')).toEqual([
      'Drunken Master',
      'Police Story',
      'Project A',
    ])
  })

  it('ignores blank lines and surrounding whitespace, so pasted text just works', () => {
    expect(parseItemTitles('  Drunken Master  \n\n\n   \nPolice Story\n')).toEqual([
      'Drunken Master',
      'Police Story',
    ])
  })

  it('returns nothing for an empty box', () => {
    expect(parseItemTitles('')).toEqual([])
    expect(parseItemTitles('   \n  \n')).toEqual([])
  })
})
