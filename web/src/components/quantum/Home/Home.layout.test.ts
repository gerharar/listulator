import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// jsdom applies no stylesheet, so the layout rules are read from the files themselves. What the real screen does with them
// (every row's bars starting at one x across categories, in both engines) is the e2e spec's job (task 44.5).
const home = readFileSync(join(import.meta.dirname, 'Home.css'), 'utf8')
const row = readFileSync(join(import.meta.dirname, '../HomeRow/HomeRow.css'), 'utf8')

/** The text of the `@supports (grid-template-columns: subgrid) { … }` block, braces balanced. */
function subgridBlock(css: string): string {
  const start = css.indexOf('@supports (grid-template-columns: subgrid)')
  if (start < 0) return ''
  let depth = 0
  for (let at = css.indexOf('{', start); at < css.length; at++) {
    if (css[at] === '{') depth++
    if (css[at] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, at)
  }

  return ''
}

describe('My Lists is one grid whose rows are subgrids (H-024)', () => {
  const grid = subgridBlock(home) + subgridBlock(row)

  it('guards the grid with @supports, so a WebKit without subgrid keeps the flex row instead of breaking (owner, 2026-10-31)', () => {
    expect(subgridBlock(home)).not.toBe('')
    expect(subgridBlock(row)).not.toBe('')
  })

  it('has the title as the one flexible column, then the NEW badge, the bar and percentage, and the count, 16px apart', () => {
    expect(grid).toMatch(/\.q-home-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto\s*;/)
    expect(grid).toMatch(/\.q-home-body\s*\{[^}]*column-gap:\s*16px\s*;/)
  })

  it('makes every category block and every row a subgrid spanning all columns, so each column is as wide as its widest cell', () => {
    expect(grid).toMatch(/\.q-bucket\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;[^}]*grid-template-columns:\s*subgrid\s*;/)
    expect(grid).toMatch(/\.q-home-row\s*\{[^}]*grid-column:\s*1\s*\/\s*-1\s*;[^}]*grid-template-columns:\s*subgrid\s*;/)
    expect(grid).toMatch(/\.q-home-cluster\s*\{[^}]*grid-column:\s*3\s*\/\s*span\s*2\s*;[^}]*grid-template-columns:\s*subgrid\s*;/)
  })

  it('has no fixed width on the count any more (it was 112px), and none on the time where the grid is used', () => {
    expect(row).not.toMatch(/112px/)
  })

  it('adds a fifth, auto column for the time left when the setting is on, and puts each row’s time in it, 24px after the count (16 + 8)', () => {
    expect(grid).toMatch(/\.q-home-body\.with-time\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto\s+auto\s*;/)
    expect(grid).toMatch(/\.q-home-row\s+\.q-left\s*\{[^}]*grid-column:\s*5\s*;[^}]*justify-self:\s*end\s*;[^}]*margin-left:\s*8px\s*;/)
  })

  it('keeps no fixed width on the time column where the grid is used (the flex fallback keeps its 114px)', () => {
    expect(subgridBlock(row)).not.toMatch(/114px/)
    expect(subgridBlock(row)).toMatch(/\.q-left\s*\{[^}]*min-width:\s*0\s*;/)
  })
})
