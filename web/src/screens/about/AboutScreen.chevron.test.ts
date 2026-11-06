import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The TMDB row's arrow (canvas H-027): the row-fold triangle, centred in a 12px column (the glyph's old column, so no text moves), its middle on the
 * middle of the label's cap height. The label is Inter, whose cap height is 0.7275em; the offset is written in em, never the `cap` unit, which
 * Safari lacks before 17.2 while the app runs on macOS 11 and later (DECISIONS 2026-11-06). The triangle sits in a flex row aligned on the baseline,
 * with its box's bottom on it, so it is lifted by (cap height - ink height) / 2 plus the box's spare pixel: open (turned down, ink y 0 to 7 of 8)
 * `0.5cap - 4.5px`, shut (turned right, ink 8 tall) `0.5cap - 4px`. jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'AboutScreen.css'), 'utf8')
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the TMDB row’s arrow stylesheet', () => {
  it('keeps the 12px column the glyph had, and holds no font of its own', () => {
    const column = rule('.q-about-chevron')

    expect(column).toMatch(/width:\s*12px/)
    expect(column).not.toMatch(/font-size:\s*11px/)
    expect(column).not.toMatch(/rotate/)
  })

  it('lifts the arrow by 0.5cap - 4.5px in both states, so the box does not move when it turns, in em (0.36375em is half of Inter’s 0.7275)', () => {
    expect(rule('.q-about-chevron')).toMatch(/top:\s*calc\(4\.5px - 0\.36375em\)/)
    expect(rule('.q-about-tmdb.open .q-about-chevron')).toBe('')
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\b\d*\.?\d+cap\b/)
  })

  it('turns the triangle in 160ms, and not at all when the system asks for less motion', () => {
    expect(rule('.q-about-chevron .q-triangle')).toMatch(/transition:\s*transform 160ms/)
    expect(css).toMatch(/\[data-reduced\] \.q-about-chevron \.q-triangle\s*\{[^}]*transition:\s*none/)
  })
})
