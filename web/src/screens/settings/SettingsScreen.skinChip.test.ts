import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Found by the owner at X-003 (owner-checks T, step 1): under eX-Zed the current skin chip did not stand out, because its accent border and the others'
 * frame border are two yellows (Lode), two whites (Glemt) or the same black (Lotus). Design's ToggleChip lights the picked chip as an `acc` block with
 * `acc-ink` text, like the THEME and language chips. jsdom cannot resolve a theme, so this reads the CSS.
 */
const css = readFileSync(join(import.meta.dirname, 'SettingsScreen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const chipCss = readFileSync(join(import.meta.dirname, '..', '..', 'components', 'quantum', 'ToggleChip', 'ToggleChip.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const rule = (source: string, selector: string): string =>
  new RegExp(`${selector.replace(/[.[\]()]/g, '\\$&')}\\s*{([^}]*)}`).exec(source)?.[1] ?? ''

describe('the current skin chip', () => {
  it('under eX-Zed is an accent block with the accent’s ink, as the THEME and language chips are', () => {
    const skin = rule(css, "html.theme-exzed .q-chip.choice.skin[aria-pressed='true']")
    expect(skin).toMatch(/background:\s*var\(--accent\)/)
    expect(skin).toMatch(/color:\s*var\(--accentInk\)/)
    const choice = rule(chipCss, ".q-chip[aria-pressed='true']")
    expect(choice).toMatch(/background:\s*var\(--accent\)/)
  })

  it('under Quantum stays outlined (accent border, no fill): the rule that lights it is eX-Zed’s alone', () => {
    const quantum = rule(css, ".q-chip.choice.skin[aria-pressed='true']")
    expect(quantum).toMatch(/background:\s*transparent/)
    expect(quantum).toMatch(/border-color:\s*var\(--accent\)/)
  })
})
