import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The List Vault's sort arrow (canvas H-027) is the 6 x 5 picker triangle in the label's colour, 5px from the label: on its right for a text column, on its
 * left for a number column (whose header ends on its numbers' right edge), and no room at all when the column is not sorted (the span is not drawn).
 * It was a 9px text glyph. jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'VaultBrowser.css'), 'utf8')
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the sort arrow’s stylesheet', () => {
  it('holds no font size: it is a drawing, not a glyph', () => {
    expect(rule('.q-vb-arrow')).not.toMatch(/font-size/)
  })

  it('stays 5px from the label, right of it in a text column and left of it in a number column', () => {
    expect(rule('.q-vb-colhead:not(.number) .q-vb-arrow')).toMatch(/margin-left:\s*5px/)
    expect(rule('.q-vb-colhead.number .q-vb-arrow')).toMatch(/margin-right:\s*5px/)
    expect(rule('.q-vb-colhead.number .q-vb-sort')).toMatch(/flex-direction:\s*row-reverse/)
  })

  it('is in the label’s colour (no colour of its own)', () => {
    expect(rule('.q-vb-arrow')).not.toMatch(/color:/)
  })
})
