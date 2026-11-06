import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Task 11.7: in an expanded result every line shares one left edge, and the provenance line reads as
 * text like the description above it, not as a small mono stamp. jsdom cannot lay anything out, so
 * this reads the CSS: the band's left padding must equal where the row's own text starts.
 */
const css = readFileSync(join(import.meta.dirname, 'SearchResultRow.css'), 'utf8')

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}
const px = (value: string | undefined): number => Number(value?.replace('px', ''))

describe('expanded search result', () => {
  it('the band starts where the row text starts: row padding-left + chevron + gap', () => {
    const row = rule('.q-result')
    const paddingLeft = px(/padding:\s*\S+\s+\S+\s+\S+\s+(\d+px)/.exec(row)?.[1])
    const gap = px(/\bgap:\s*(\d+px)/.exec(row)?.[1])
    const chevron = px(/width:\s*(\d+px)/.exec(rule('.q-result .chev'))?.[1])
    const band = px(/padding:\s*\S+\s+\S+\s+\S+\s+(\d+px)/.exec(rule('.q-result-more'))?.[1])

    expect(band).toBe(paddingLeft + chevron + gap)
  })

  /**
   * Canvas H-027: the arrow is the row-fold triangle (an 8 x 8 box, ink 8 x 7 at its top) centred in the 12px column the glyph had, so no text moves (design's
   * answer of 2026-11-06, reading A: the title and the open block stay at 30px). Vertically its middle is the title's cap middle: the column and the text
   * block are both on the baseline, the column's bottom on it, lifted by 0.5cap - 4.5px open (ink y 0 to 7) and 0.5cap - 4px shut (turned, ink 8 tall).
   * Written in em, with Inter's cap height 0.7275em, never the cap unit: Safari lacks it before 17.2 and the app runs on macOS 11 and later.
   */
  it('the arrow is a 12px column holding the drawing, with no font of its own', () => {
    const chevron = rule('.q-result .chev')

    expect(chevron).toMatch(/width:\s*12px/)
    expect(chevron).toMatch(/justify-content:\s*center/)
    expect(chevron).not.toMatch(/font-size:\s*11px/)
  })

  it('the column and the text block are on the baseline together; the count column stays centred', () => {
    expect(rule('.q-result .chev')).toMatch(/align-self:\s*baseline/)
    expect(rule('.q-result .main')).toMatch(/align-self:\s*baseline/)
    expect(rule('.q-result .n')).not.toMatch(/align-self:\s*baseline/)
    expect(rule('.q-result')).toMatch(/align-items:\s*center/)
  })

  it('lifts the shut arrow by 0.5cap - 4px and the open one by 0.5cap - 4.5px, in em of the title’s 15px', () => {
    expect(rule('.q-result .chev')).toMatch(/font-size:\s*15px/)
    expect(rule('.q-result .chev')).toMatch(/top:\s*calc\(4px - 0\.36375em\)/)
    expect(rule(".q-result[aria-expanded='true'] .chev")).toMatch(/top:\s*calc\(4\.5px - 0\.36375em\)/)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\b\d*\.?\d+cap\b/)
  })

  it('the details block shows the pointer, like the row it belongs to', () => {
    expect(rule('.q-result-more')).toMatch(/cursor:\s*pointer/)
  })

  it('the provenance line is UI-font text at 13px in ink2, like the description', () => {
    const prov = rule('.q-result-more .prov')
    expect(prov).toMatch(/font:\s*400 13px\/1\.4 var\(--font-sans\)/)
    expect(prov).toMatch(/color:\s*var\(--ink2\)/)
  })
})
