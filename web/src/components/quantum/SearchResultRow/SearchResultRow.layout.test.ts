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

  it('the chevron is a filled triangle at the design’s 11px in a 12px column', () => {
    const chevron = rule('.q-result .chev')

    expect(chevron).toMatch(/font-size:\s*11px/)
    expect(chevron).toMatch(/width:\s*12px/)
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
