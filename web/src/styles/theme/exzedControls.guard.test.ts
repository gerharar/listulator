import { describe, expect, it } from 'vitest'
import { declarations, read } from './cssGuard.js'

/**
 * Controls are `ctl`, text that only informs and disabled controls are `ink2` (design's D47, the owner, 2026-11-15; task A2). The sweep reads it on the screens (`IDENTITY_MODE=sweep`); this reads the
 * stylesheets, so a rule that moves a control back to the grey fails here at once, with its name. "At rest" is the plain rule: its hover, picked and disabled looks are other rules.
 */
const colourOf = (file: string, selector: string): string[] =>
  declarations(read(file))
    .filter((d) => d.property === 'color' && d.selector.split(',').some((part) => part.trim() === selector))
    .map((d) => d.value)

describe('controls at rest are ctl', () => {
  const AT_REST: [string, string][] = [
    ['styles/theme/exzed-buttons.css', 'html.theme-exzed .q-btn'],
    ['styles/theme/exzed-buttons.css', 'html.theme-exzed .q-icon-btn:not(.rail)'],
    ['styles/theme/exzed-chips.css', 'html.theme-exzed .q-chip'],
    ['styles/theme/exzed-chips.css', 'html.theme-exzed .q-chip.choice.skin'],
    ['styles/theme/exzed-chips.css', 'html.theme-exzed .q-tabs button'],
    ['styles/theme/exzed-fields.css', 'html.theme-exzed .q-key button'],
    ['styles/theme/exzed-fields.css', 'html.theme-exzed .q-platfield-caret'],
    ['styles/theme/exzed-rail.css', 'html.theme-exzed .q-rail-head .q-rail-toggle'],
    ['styles/theme/exzed-rail.css', 'html.theme-exzed .q-rail-stub'],
    ['styles/theme/exzed-rows.css', 'html.theme-exzed .q-handle'],
    ['styles/theme/exzed-rows.css', 'html.theme-exzed .q-item .q-icon-btn.row'],
    ['styles/theme/exzed.css', 'html.theme-exzed .q-layer-tab:not(:hover)'],
  ]

  it.each(AT_REST)('%s: %s', (file, selector) => {
    expect(colourOf(file, selector)).toEqual(['var(--zx-ctl)'])
  })

  it('and a disabled button or icon button is still the secondary grey, dimmer than a live one', () => {
    expect(colourOf('styles/theme/exzed-buttons.css', "html.theme-exzed .q-btn:disabled:not([aria-busy='true'])")).toEqual(['var(--zx-ink2)'])
    expect(colourOf('styles/theme/exzed-buttons.css', "html.theme-exzed .q-icon-btn:disabled:not([aria-busy='true'])")).toEqual(['var(--zx-ink2)'])
    expect(colourOf('styles/theme/exzed-chips.css', 'html.theme-exzed .q-chip:disabled')).toEqual(['var(--zx-ink2)'])
  })
})
