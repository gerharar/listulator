import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Task 11.2: a disabled control never reacts to the pointer. jsdom cannot
 * hover, so this reads the CSS instead. The three classes below are the only
 * controls the app disables (Button, IconButton, ToggleChip); every `:hover`
 * rule that targets one must exclude `:disabled`, so no variant can out-rank
 * the disabled look by specificity.
 */

const SRC = join(import.meta.dirname)

const DISABLEABLE = /\.q-(btn|icon-btn|chip)\b/
const GUARD = /:not\(:disabled\)/

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

/** Every selector in every stylesheet, comments stripped, as `file: selector`. */
function selectors(): string[] {
  return cssFiles(SRC).flatMap((file) => {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const name = relative(SRC, file).split('\\').join('/')
    return [...css.matchAll(/([^{}]+)\{/g)].flatMap((match) =>
      (match[1] ?? '')
        .split(',')
        .map((selector) => selector.trim())
        .filter(Boolean)
        .map((selector) => `${name}: ${selector}`),
    )
  })
}

describe('disabled controls and :hover', () => {
  it('every :hover rule on a disableable control excludes :disabled', () => {
    const bad = selectors().filter(
      (selector) => DISABLEABLE.test(selector) && /:hover/.test(selector) && !GUARD.test(selector),
    )
    expect(bad).toEqual([])
  })

  it('no :disabled:hover band-aid is left to fight a hover rule', () => {
    expect(selectors().filter((selector) => /:disabled:hover/.test(selector))).toEqual([])
  })
})
