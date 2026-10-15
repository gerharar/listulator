import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `var(--font)` names a token that does not exist (the tokens are `--font-sans` and `--font-mono`). A `font` shorthand
 * that uses it is invalid at computed-value time, so the browser drops the whole declaration and the text inherits:
 * weight and size are lost without any error. Found on the item card's title (H-003, 2026-10-15); the twelve older
 * uses were fixed under BL-097 (owner, 2026-10-15).
 */
const SRC = join(import.meta.dirname)

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

describe('the font token', () => {
  it('no stylesheet uses var(--font), which is not defined', () => {
    const using = cssFiles(SRC)
      .filter((file) => /var\(--font\)/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .sort()

    expect(using).toEqual([])
  })
})
