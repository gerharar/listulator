import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The hint must read as content, not as a banner (design 3A): no box, no tint, no accent colour. Its one gold is the curated star's (a component, not this stylesheet).
 * jsdom cannot lay anything out, so this reads the stylesheet.
 */
const css = readFileSync(join(import.meta.dirname, 'CrossHintRow.css'), 'utf8')

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()>]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the hint row’s styling', () => {
  it('draws its icon in ink, not accent and not the star’s gold', () => {
    expect(rule('.q-hint-icon')).toMatch(/color:\s*var\(--ink\)/)
    expect(css).not.toMatch(/--star/)
  })

  it('never uses the accent colour anywhere', () => {
    expect(css).not.toMatch(/--accent/)
  })

  it('shows the list titles one size below a result title (14px against 15px)', () => {
    expect(rule('.q-hint-list .title')).toMatch(/font:\s*500 14px/)
  })

  it('sets the row’s title in 600, one step heavier than a result title', () => {
    expect(rule('.q-result.q-hint .title')).toMatch(/font-weight:\s*600/)
  })

  it('sets the row off with the 2px rule of the results header instead of the light row rule', () => {
    expect(rule('.q-result.q-hint')).toMatch(/border-bottom:\s*2px solid var\(--rule\)/)
  })

  it('moves that rule below the open panel, so the open row is still one group', () => {
    expect(rule(".q-result.q-hint[aria-expanded='true']")).toMatch(/border-bottom:\s*0/)
    expect(rule('.q-result-more.q-hint-more')).toMatch(/border-bottom:\s*2px solid var\(--rule\)/)
  })

  it('keeps the subline to one line', () => {
    const subline = rule('.q-hint .meta')

    expect(subline).toMatch(/white-space:\s*nowrap/)
    expect(subline).toMatch(/text-overflow:\s*ellipsis/)
  })
})
