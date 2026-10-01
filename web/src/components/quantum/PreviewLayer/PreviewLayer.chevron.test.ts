import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Preview layer's group toggle was drawn with the small triangles ▸ and ▾ (about 4 x 4 px), less than half
 * the size of the list screen's group rows and of the design system's PreviewRow (a 15px ▼, turned when folded).
 * jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'PreviewLayer.css'), 'utf8')

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.[\]()=']/g, '\\$&')
  return new RegExp(`(?:^|\\}|\\*\\/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
}

describe('the Preview layer group toggle', () => {
  it('is the list screen’s chevron: 500 15px in a 20px column', () => {
    const chevron = rule('.q-preview-group .q-chev')

    expect(chevron).toMatch(/font:\s*500 15px\/1/)
    expect(chevron).toMatch(/width:\s*20px/)
  })

  it('turns a quarter when the group is folded, as the list screen’s does', () => {
    expect(rule(".q-preview-group[aria-expanded='false'] .q-chev")).toMatch(/transform:\s*rotate\(-90deg\)/)
  })
})
