import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Preview's group head is the list's head (canvas H-027, design's answer of 2026-11-06): its name is `600 15px/1.15` with `.01em` letter-spacing, as the
 * list's is (`Spine.css` `.q-group .name b`). It was 14px, which put the triangle a pixel off the name's cap middle in Chromium. The row stays 40px,
 * which is design's 10px top and bottom padding round the 20px triangle box, and which the Preview's windowing counts on (`previewRows.ts`, 40px a row).
 * jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'PreviewLayer.css'), 'utf8')
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()=']/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the Preview group head', () => {
  it('names the group in 600 15px/1.15 with .01em letter-spacing, like the list’s head', () => {
    const name = rule('.q-preview-group .name')

    expect(name).toMatch(/font:\s*600 15px\/1\.15 var\(--font-sans\)/)
    expect(name).toMatch(/letter-spacing:\s*\.01em/)
  })

  it('keeps the count out of that spacing, and the row at 40px', () => {
    expect(rule('.q-preview-group')).not.toMatch(/letter-spacing/)
    expect(rule('.q-preview-group')).toMatch(/height:\s*40px/)
  })
})
