import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `var(--font)` names a token that does not exist (the tokens are `--font-sans` and `--font-mono`). A `font` shorthand
 * that uses it is invalid at computed-value time, so the browser drops the whole declaration and the text inherits:
 * weight and size are lost without any error. Found on the item card's title (H-003, 2026-10-15), which was meant to
 * be bold. The files below still have it (BACKLOG BL-097): they are listed so nothing NEW can; each one that is fixed
 * comes off this list.
 */
const SRC = join(import.meta.dirname)
const STILL_BROKEN = [
  'components/quantum/CategoryPicker/CategoryPicker.css',
  'components/quantum/PlatformChip/PlatformCard.css',
  'components/quantum/PreviewLayer/PreviewLayer.css',
  'components/quantum/PreviewRow/PreviewRow.css',
  'screens/list/JumpRail.css',
  'screens/list/Spine.css',
]

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

describe('the font token', () => {
  it('no stylesheet uses var(--font), which is not defined, beyond the ones known to', () => {
    const using = cssFiles(SRC)
      .filter((file) => /var\(--font\)/.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')))
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .sort()

    expect(using).toEqual([...STILL_BROKEN].sort())
  })
})
