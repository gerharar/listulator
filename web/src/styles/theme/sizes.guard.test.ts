import { describe, expect, it } from 'vitest'
import { declared, definitions, plain, read } from './cssGuard.js'

/**
 * Sizes are hooks (Phase 48.4, X-002): the height of a row and of a control is read from a token, so a theme can set its own (eX-Zed: rows 32px,
 * controls 40px). A token's Quantum value is the literal it replaced (pinned from 1.4.0, `b475e5d`); the identity tool shows the pixels, this shows
 * why they cannot drift. What is not hooked here, on purpose: fields, chips and menu rows (X-007 draws them), the rail's own small buttons and the
 * group header's 26px handle and buttons (a row's parts that overflow at 32px are noted, not fixed, in this task).
 */
const QUANTUM = {
  '--row-h': '46px',
  '--group-h': '47px',
  '--control-h': 'auto',
  '--control-h-icon': '36px',
  '--control-h-list': '34px',
} as const

const EXZED = { '--row-h': '32px', '--group-h': '32px', '--control-h': '40px', '--control-h-icon': '40px', '--control-h-list': '40px' } as const

const USES: readonly { file: string; selector: string; token: keyof typeof QUANTUM }[] = [
  { file: 'screens/list/Spine.css', selector: '.q-item', token: '--row-h' },
  { file: 'screens/list/Spine.css', selector: '.q-item .body', token: '--row-h' },
  { file: 'screens/list/Spine.css', selector: '.q-handle', token: '--row-h' },
  { file: 'screens/list/Spine.css', selector: '.q-group', token: '--group-h' },
  { file: 'components/quantum/DoneCheckbox/DoneCheckbox.css', selector: '.q-done', token: '--row-h' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-icon-btn.row', token: '--row-h' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-btn', token: '--control-h' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-icon-btn', token: '--control-h-icon' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-icon-btn.sq', token: '--control-h-icon' },
  { file: 'components/quantum/Button/Button.css', selector: '.q-icon-btn.list', token: '--control-h-list' },
]

describe('size tokens: rows and controls', () => {
  it.each(USES)('$selector in $file takes its height from $token, not from a literal', ({ file, selector, token }) => {
    expect(declared(read(file), selector, 'height')).toBe(`var(${token})`)
  })

  it.each(Object.entries(QUANTUM))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    const values = definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css'])

    expect(values).toHaveLength(1)
    expect(plain(values[0]!)).toBe(literal)
  })

  it('a group’s header stays one pixel taller than a row (its border), in Quantum', () => {
    expect(Number.parseInt(QUANTUM['--group-h'])).toBe(Number.parseInt(QUANTUM['--row-h']) + 1)
  })
})

describe('eX-Zed’s sizes: rows and controls', () => {
  const exzed = read('styles/theme/exzed.css')
  const value = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it.each(Object.entries(EXZED))('sets %s to %s (design’s tokens.json: row-h 32px, control-h 40px)', (token, size) => {
    expect(value(token), token).toBe(size)
  })
})

describe('size tokens: the width of a layer and the stage’s side gap', () => {
  const WIDTHS = { '--stage-gap': '20px', '--layer-max-list': '1080px' } as const
  const EXZED_WIDTHS = { '--stage-gap': '96px', '--layer-max': '1620px', '--layer-max-wide': '2100px', '--layer-max-list': '2100px' } as const
  const px = (value: string) => Number.parseFloat(value)
  const quantum = (token: string) => definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css'])
  const exzed = read('styles/theme/exzed.css')
  const exzedValue = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it('the stage keeps each layer its gap from the window’s sides through --stage-gap', () => {
    const app = read('App.css')

    expect(declared(app, '.q-stage .q-layer', 'left')).toBe('var(--stage-gap)')
    expect(declared(app, '.q-stage .q-layer', 'right')).toBe('var(--stage-gap)')
  })

  it.each(Object.entries(WIDTHS))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    expect(quantum(token).map(plain)).toEqual([literal])
  })

  it.each(Object.entries(EXZED_WIDTHS))('eX-Zed sets %s to %s (1.5 x the cap; at least 96px of background each side)', (token, size) => {
    expect(exzedValue(token), token).toBe(size)
  })

  it('the rail’s rule in TypeScript and the CSS cannot disagree about Quantum’s card and gap: one set of numbers', async () => {
    const { QUANTUM_GEOMETRY } = await import('../../screens/list/railPlacement.js')

    expect(QUANTUM_GEOMETRY.cardMax).toBe(px(quantum('--layer-max-list')[0]!))
    expect(QUANTUM_GEOMETRY.inset).toBe(px(quantum('--stage-gap')[0]!))
    // The list's card is the cap of the list layer, and the plain layer's cap is the same number in Quantum.
    expect(QUANTUM_GEOMETRY.cardMax).toBe(px(quantum('--layer-max')[0]!))
  })
})

describe('size tokens: the covered layer’s tab', () => {
  it('the tab’s height is --tab-h, 34px in Quantum and 48px in eX-Zed (the Window card)', () => {
    expect(declared(read('components/quantum/LayerCard/LayerCard.css'), '.q-layer-tab', 'height')).toBe('var(--tab-h)')
    expect(definitions('--tab-h', ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual(['34px'])
    expect(new RegExp('--tab-h\\s*:\\s*([^;]+);').exec(read('styles/theme/exzed.css'))?.[1]?.trim()).toBe('48px')
  })
})
