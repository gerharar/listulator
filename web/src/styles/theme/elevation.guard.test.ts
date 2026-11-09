import { describe, expect, it } from 'vitest'
import { declared, definitions, plain, read, topLevel } from './cssGuard.js'

/**
 * Elevation is a hook (Phase 48.2, X-002): every shadow a Quantum overlay draws is read from a token, so a theme can replace it with a frame.
 * The token's Quantum value is the literal it replaced, character for character (pinned here from 1.4.0, `b475e5d`), so a Quantum screen is the same
 * before and after; the identity tool (web/e2e-tools) shows the pixels, this shows why they cannot drift. The keyframes that carry their own
 * literals (`q-drumShadow`) are deliberately left as they were: the tool samples settled screens and cannot see them, and eX-Zed replaces its own
 * motion in X-007.
 */

/** What 1.4.0 wrote as a literal in each place, now read through the token. */
const QUANTUM = {
  '--e-pop': '0 12px 30px rgba(0,0,0,.18)',
  '--e-toast': '0 10px 26px rgba(0,0,0,.18)',
  '--e-sheet': '0 16px 28px rgba(0,0,0,.14)',
  '--e-layer-rest': '0 20px 48px rgba(0,0,0,.22),0 3px 10px rgba(0,0,0,.1)',
  '--e-layer-covered': '0 8px 18px rgba(0,0,0,.1)',
  '--e-tooltip': '0 4px 14px rgba(0,0,0,.2)',
} as const

const USES: readonly { file: string; selector: string; token: keyof typeof QUANTUM }[] = [
  { file: 'components/quantum/Popover/Popover.css', selector: '.q-pop', token: '--e-pop' },
  { file: 'components/quantum/PlatformPanel/PlatformPanel.css', selector: '.q-platpanel', token: '--e-pop' },
  { file: 'screens/list/GroupCombobox.css', selector: '.q-combo-list', token: '--e-pop' },
  { file: 'components/quantum/Toast/Toast.css', selector: '.q-toast', token: '--e-toast' },
  { file: 'components/quantum/Sheet/Sheet.css', selector: '.q-sheet', token: '--e-sheet' },
  { file: 'components/quantum/LayerCard/LayerCard.css', selector: '.q-layer', token: '--e-layer-rest' },
  { file: 'components/quantum/LayerCard/LayerCard.css', selector: '.q-layer.covered', token: '--e-layer-covered' },
  { file: 'components/quantum/Tooltip/Tooltip.css', selector: '.q-tooltip', token: '--e-tooltip' },
]

/** Quantum's own values: the generated tokens, and the contract file for the one token design's file does not have (the tooltip's). */
const quantumValue = (token: string) => definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css'])

describe('elevation tokens', () => {
  it.each(USES)('$selector in $file draws its shadow from $token, not from a literal', ({ file, selector, token }) => {
    expect(declared(read(file), selector, 'box-shadow')).toBe(`var(${token})`)
  })

  it.each(Object.entries(QUANTUM))('Quantum’s %s is exactly the literal it replaced', (token, literal) => {
    const values = quantumValue(token)

    expect(values).toHaveLength(1)
    expect(plain(values[0]!)).toBe(literal)
  })

  it('the drum-in keyframes keep their literals: they are not part of X-002', () => {
    const css = read('components/quantum/LayerCard/LayerCard.css')
    const keyframes = /@keyframes q-drumShadow\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? ''

    expect(plain(keyframes)).toContain('0 26px 30px -18px rgba(0,0,0,.34),0 3px 10px rgba(0,0,0,.12)')
    expect(plain(keyframes)).toContain('0 20px 48px rgba(0,0,0,.22),0 3px 10px rgba(0,0,0,.1)')
    expect(keyframes).not.toContain('var(')
  })
})

describe('eX-Zed’s elevation', () => {
  const exzed = read('styles/theme/exzed.css')
  const value = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it.each(Object.keys(QUANTUM))('replaces %s, so a theme cannot be left with a Quantum shadow', (token) => {
    expect(value(token), token).toBeDefined()
  })

  it.each(Object.keys(QUANTUM))('%s is frames and no blur: every entry is `0 0 0 <n>px <colour>`, or none', (token) => {
    const entries = topLevel(plain(value(token)!))

    for (const entry of entries) expect(entry, token).toMatch(/^(none|0 0 0 \d+px var\(.+\))$/)
  })

  it('gives a full layer the three rings design draws outside the 4px border (paper, frame, paper), and everything that opens over a layer (popovers, menus, toasts, the helper sheet) the one paper ring (design, answer 5)', () => {
    const paper = 'var(--zx-paper)'
    const frame = 'var(--zx-frame)'

    expect(plain(value('--e-layer-rest')!)).toBe(`0 0 0 4px ${paper},0 0 0 8px ${frame},0 0 0 12px ${paper}`)
    for (const token of ['--e-pop', '--e-toast', '--e-sheet']) expect(plain(value(token)!), token).toBe(`0 0 0 4px ${paper}`)
  })

  it('has no shadow at all for the tooltip (2px border, no ring) and for a covered layer (a tab with a border)', () => {
    expect(value('--e-tooltip')).toBe('none')
    expect(value('--e-layer-covered')).toBe('none')
  })
})
