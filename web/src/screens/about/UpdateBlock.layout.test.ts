import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The update block's button label is centred (owner, 2026-10-01; the design README says left-aligned). The labels
 * are stacked in one cell as wide as the longest, so a shorter label ("Try Again") sat against the left edge with
 * empty space after it. The status and version lines beside it stay left-aligned. jsdom cannot lay anything out,
 * so this reads the stylesheet.
 */
const css = readFileSync(join(import.meta.dirname, 'AboutScreen.css'), 'utf8')

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()>]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the update block’s alignment', () => {
  it('centres the button label, whichever variant is showing', () => {
    expect(rule('.q-about-update-block .q-btn .q-about-stack')).toMatch(/text-align:\s*center/)
  })

  it('keeps the status line and the version line left-aligned', () => {
    expect(rule('.q-about-stack')).toMatch(/text-align:\s*left/)
  })
})
