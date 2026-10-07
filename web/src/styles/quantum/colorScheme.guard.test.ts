import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BL-079: the native scrollbar (and the form controls) take their colours from `color-scheme`. `base.css` once set
 * `light dark`, which follows the operating system, so a dark skin on a light Windows theme drew a white scrollbar. A skin's
 * name starts with `dark-` or `light-`, and the page's `color-scheme` has to follow the skin, not the system.
 */
const dir = import.meta.dirname
const base = readFileSync(join(dir, 'base.css'), 'utf8')
const tokens = readFileSync(join(dir, 'tokens.css'), 'utf8')

const skins = [...new Set([...tokens.matchAll(/html\[data-theme="([a-z0-9-]+)"\]/g)].map((match) => match[1]!))]

/** The `color-scheme` of every rule in base.css whose selector is exactly `selector`. */
function schemesOf(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return [...base.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))].flatMap((rule) =>
    [...rule[1]!.matchAll(/color-scheme:\s*([a-z ]+);/g)].map((declaration) => declaration[1]!.trim()),
  )
}

describe('the page’s colour scheme follows the skin (BL-079)', () => {
  it('knows every skin of the token file, and each is a dark or a light one', () => {
    expect(skins.length).toBeGreaterThanOrEqual(5)
    for (const skin of skins) expect(skin, skin).toMatch(/^(dark|light)-/)
  })

  it('makes every dark skin dark', () => {
    expect(schemesOf('html[data-theme^="dark"]')).toEqual(['dark'])
  })

  it('makes every light skin light', () => {
    expect(schemesOf('html[data-theme^="light"]')).toEqual(['light'])
  })

  it('leaves no rule that sets the system-following scheme once a skin is chosen', () => {
    expect(schemesOf('html')).toEqual(['light dark'])
    expect(base).not.toMatch(/data-theme[^{]*\{[^}]*color-scheme:\s*light dark/)
  })
})
