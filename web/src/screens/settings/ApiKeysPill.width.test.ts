import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { en } from '../../locale/en.js'
import { ru } from '../../locale/ru.js'
import { de } from '../../locale/de.js'

/**
 * Task 11.6: pressing Test changes the status pill's label (Untested → Testing → Working),
 * and a pill that sized itself to its label would push everything after it sideways. The pill is
 * therefore one fixed width, `--pill-chars` monospace characters, and that number must cover the
 * longest status label of every language. jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'ApiKeysSection.css'), 'utf8')

const widest = Math.max(
  ...[en, ru, de].flatMap((locale) => Object.values(locale.quantum.settings.keys.status).map((label) => label.length)),
)

describe('API-key status pill width', () => {
  it('is fixed to the longest status label of any language, not to its own text', () => {
    const declared = Number(/--pill-chars:\s*(\d+)\s*;/.exec(css)?.[1])
    expect(declared).toBe(widest)
  })

  it('takes that width as a fixed one, with no min-width to grow past', () => {
    const rule = /\.q-key-pill\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/\bwidth:\s*calc\(var\(--pill-chars\)/)
    expect(rule).not.toMatch(/min-width/)
  })
})
