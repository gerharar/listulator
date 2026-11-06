import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The group head's triangle (canvas H-022, H-027) is one drawing, in one stylesheet, for the list screen and the Preview. It used to be a 15px ▼ glyph
 * with a copy of its rules in each of `Spine.css` and `PreviewLayer.css`; the glyph's rules must not come back (a text glyph is what the canvas ruled out,
 * and a box turned a quarter beside a drawing that also turns would turn it twice). jsdom cannot lay anything out, so this reads the CSS.
 */
const read = (file: string) => readFileSync(join(import.meta.dirname, file), 'utf8')
const triangleCss = read('../GroupTriangle/GroupTriangle.css')
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.[\]()=']/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the group head’s triangle stylesheet', () => {
  it('is owned by GroupTriangle.css: Preview and the list screen keep no glyph rule of their own', () => {
    expect(read('PreviewLayer.css')).not.toMatch(/\.q-chev\b(?!-)/)
    expect(read('../../../screens/list/Spine.css')).not.toMatch(/\.q-chev\b(?!-)/)
  })

  it('is a 20px box holding the drawing, with no font', () => {
    const box = rule(triangleCss, '.q-chev')

    expect(box).toMatch(/width:\s*20px/)
    expect(box).toMatch(/height:\s*20px/)
    expect(box).not.toMatch(/font/)
  })

  it('turns the drawing (not the box) a quarter when the head is folded, in the list and in the Preview, 140ms', () => {
    expect(triangleCss).toMatch(/\.q-group\[aria-expanded='false'\] \.q-chev-tri,\s*\.q-preview-group\[aria-expanded='false'\] \.q-chev-tri\s*\{[^}]*rotate\(-90deg\)/)
    expect(triangleCss).toMatch(/\.q-preview-group\[aria-expanded='false'\] \.q-chev-tri/)
    expect(rule(triangleCss, '.q-chev-tri')).toMatch(/transition:\s*transform 140ms/)
    expect(triangleCss).not.toMatch(/\.q-chev\s*\{[^}]*rotate/)
  })

  it('turns about its own centre, which stays on whole pixels in the 20px box (H-027)', () => {
    expect(rule(triangleCss, '.q-chev-tri')).toMatch(/transform-origin:\s*7px 6px/)
  })
})
