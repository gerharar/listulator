import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The hint must read as content, not as a banner (design 3A): no box, no tint, no accent (accent means "curated").
 * jsdom cannot lay anything out, so this reads the stylesheet.
 */
const css = readFileSync(join(import.meta.dirname, 'CrossHintRow.css'), 'utf8')

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()>]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the hint row’s styling', () => {
  it('draws its icon in ink, not accent', () => {
    expect(rule('.q-hint-icon')).toMatch(/color:\s*var\(--ink\)/)
  })

  it('never uses the accent colour anywhere', () => {
    expect(css).not.toMatch(/--accent/)
  })

  it('shows the list titles one size below a result title (14px against 15px)', () => {
    expect(rule('.q-hint-list .title')).toMatch(/font:\s*500 14px/)
  })

  it('keeps the subline to one line', () => {
    const subline = rule('.q-hint .meta')

    expect(subline).toMatch(/white-space:\s*nowrap/)
    expect(subline).toMatch(/text-overflow:\s*ellipsis/)
  })
})
