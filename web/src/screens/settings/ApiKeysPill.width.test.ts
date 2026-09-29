import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Task 11.6: pressing Test changes the status pill's label (Untested → Testing → Working), and a pill
 * that sized itself to its label would push everything after it sideways. The pill is one fixed width
 * per language: `--pill-chars` monospace characters, set by ApiKeysSection from the current language's
 * longest status label (ApiKeysSection.test.tsx). jsdom cannot lay anything out, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'ApiKeysSection.css'), 'utf8')
const rule = /\.q-key-pill\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

describe('API-key status pill CSS', () => {
  it('is a fixed width taken from --pill-chars, with no min-width to grow past', () => {
    expect(rule).toMatch(/\bwidth:\s*calc\(var\(--pill-chars\)/)
    expect(rule).not.toMatch(/min-width/)
  })

  it('leaves the character count to the component: no number hard-coded per language', () => {
    expect(css).not.toMatch(/--pill-chars:\s*\d/)
  })
})
