import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The TMDB row's expand arrow was the small ▸ (about 3 px) while the search results draw a ▶ about twice that
 * (owner report, 2026-10-01: "should be the same size as this control on search list results"). The two are one
 * control, so they share a size; jsdom cannot lay anything out, so this reads both stylesheets.
 */
const read = (...path: string[]) => readFileSync(join(import.meta.dirname, ...path), 'utf8')
const about = read('AboutScreen.css')
const search = read('..', '..', 'components', 'quantum', 'SearchResultRow', 'SearchResultRow.css')

const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}
const declared = (block: string, property: string): string | undefined =>
  new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

describe('the TMDB row’s arrow and the search result row’s arrow', () => {
  const aboutArrow = rule(about, '.q-about-chevron')
  const searchArrow = rule(search, '.q-result .chev')

  it('are the same size', () => {
    expect(declared(aboutArrow, 'font-size')).toBe('11px')
    expect(declared(aboutArrow, 'font-size')).toBe(declared(searchArrow, 'font-size'))
  })

  it('sit in the same 12px column, centred, so the glyph is drawn the same way', () => {
    expect(declared(aboutArrow, 'width')).toBe('12px')
    expect(declared(aboutArrow, 'width')).toBe(declared(searchArrow, 'width'))
    expect(declared(aboutArrow, 'text-align')).toBe('center')
    expect(declared(aboutArrow, 'line-height')).toBe(declared(searchArrow, 'line-height'))
  })
})
