import { describe, expect, it } from 'vitest'
import { declared, definitions, plain, read } from './cssGuard.js'

/**
 * Alpha is a hook (Phase 48.3, X-002): the fades a Quantum screen draws (disabled, dragging, the covered layer's veil, the hover brightening) are
 * read from tokens, so a theme without transparency can replace each with a solid look. A token's Quantum value is the literal it replaced
 * (pinned from 1.4.0, `b475e5d`); the identity tool shows the pixels, this shows why they cannot drift. The list's busy fade (`.q-hold.is-busy`, 0.45)
 * joined them in 48.4c (design, answer 6: eX-Zed does not fade a busy list). Not hooked, on purpose: the category art's `--o-art`, which 48.6 takes.
 */
const QUANTUM = {
  '--o-disabled': '.45',
  '--o-dragging': '.4',
  '--o-disabled-soft': '.5',
  '--o-busy': '.45',
  '--veil': 'color-mix(in srgb,var(--bg) 94%,transparent)',
  '--hover-filter': 'brightness(1.12)',
  '--hover-filter-tab': 'brightness(1.1)',
} as const

const USES: readonly { file: string; selector: string; property: string; token: keyof typeof QUANTUM }[] = [
  { file: 'components/quantum/Button/Button.css', selector: '.q-btn:disabled', property: 'opacity', token: '--o-disabled' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-icon-btn:disabled', property: 'opacity', token: '--o-disabled' },
  { file: 'components/quantum/ToggleChip/ToggleChip.css', selector: '.q-chip:disabled', property: 'opacity', token: '--o-disabled' },
  { file: 'screens/list/Spine.css', selector: '.q-item.dragging, .q-group.dragging', property: 'opacity', token: '--o-dragging' },
  { file: 'screens/list/EndsButton.css', selector: '.q-ends-half:disabled', property: 'opacity', token: '--o-disabled-soft' },
  { file: 'components/quantum/HelperSheet/HelperSheet.css', selector: '.q-shelves .q-chip.none', property: 'opacity', token: '--o-disabled-soft' },
  { file: 'screens/list/ListScreen.css', selector: '.q-hold.is-busy', property: 'opacity', token: '--o-busy' },
  { file: 'components/quantum/LayerCard/LayerCard.css', selector: '.q-veil', property: 'background', token: '--veil' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-btn.primary:where(:not(:disabled)):hover', property: 'filter', token: '--hover-filter' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-btn.danger:where(:not(:disabled)):hover', property: 'filter', token: '--hover-filter' },
  { file: 'components/quantum/StatusPicker/StatusPicker.css', selector: '.q-status-picker button:hover', property: 'filter', token: '--hover-filter' },
  { file: 'components/quantum/FacetToggle/FacetToggle.css', selector: '.q-facet button:hover', property: 'filter', token: '--hover-filter' },
  { file: 'components/quantum/TabStrip/TabStrip.css', selector: ".q-tabs button[aria-selected='true']:hover", property: 'filter', token: '--hover-filter-tab' },
]

describe('alpha tokens', () => {
  it.each(USES)('$selector in $file reads $property from $token, not from a literal', ({ file, selector, property, token }) => {
    expect(declared(read(file), selector, property)).toBe(`var(${token})`)
  })

  it.each(Object.entries(QUANTUM))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    const values = definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css'])

    expect(values).toHaveLength(1)
    expect(plain(values[0]!)).toBe(literal)
  })

  it('a disabled button keeps its own `filter: none`, so a disabled primary never brightens', () => {
    expect(declared(read('components/quantum/Button/Button.css'), '.q-btn:disabled', 'filter')).toBe('none')
  })
})

describe('eX-Zed’s alpha', () => {
  const exzed = read('styles/theme/exzed.css')
  const value = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it.each(Object.keys(QUANTUM))('replaces %s, so a theme cannot be left with a Quantum fade', (token) => {
    expect(value(token), token).toBeDefined()
  })

  it('draws everything at full strength: opacity 1, no veil, no hover filter', () => {
    for (const token of ['--o-disabled', '--o-dragging', '--o-disabled-soft', '--o-busy']) expect(value(token), token).toBe('1')
    expect(value('--veil')).toBe('transparent')
    for (const token of ['--hover-filter', '--hover-filter-tab']) expect(value(token), token).toBe('none')
  })
})
