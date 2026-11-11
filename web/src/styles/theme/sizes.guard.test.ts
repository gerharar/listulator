import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  // The header\'s skin button stands beside the icon buttons and is as tall as they are (found by the owner at 49.12: a literal 36px was 4px short under eX-Zed).
  { file: 'components/quantum/AppHeader/AppHeader.css', selector: '.q-skin-btn', token: '--control-h-icon' },
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
  const WIDTHS = { '--stage-gap': '20px', '--stage-gap-min': '20px', '--layer-min': '0px', '--layer-max-list': '1080px' } as const
  // Design, answers 3 and 7: every layer is elastic from 1080px to 1620px (a list and a Preview too); the gap shrinks from 96px to 24px first.
  const EXZED_WIDTHS = { '--stage-gap': '96px', '--stage-gap-min': '24px', '--layer-min': '1080px', '--layer-max': '1620px', '--layer-max-wide': '1620px', '--layer-max-list': '1620px' } as const
  const px = (value: string) => Number.parseFloat(value)
  const quantum = (token: string) => definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css'])
  const exzed = read('styles/theme/exzed.css')
  const exzedValue = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it('the stage keeps each layer its gap from the window’s sides: --stage-gap, shrinking to --stage-gap-min once the window is narrower than the layer’s minimum and its gaps (no min-width on the layer)', () => {
    const app = read('App.css')

    expect(plain(declared(app, '.q-stage .q-layer', '--q-gap')!)).toBe('max(var(--stage-gap-min),min(var(--stage-gap),calc((100% - var(--layer-min)) / 2)))')
    expect(plain(declared(app, '.q-stage .q-layer', 'left')!)).toBe('calc(var(--q-gap) + var(--peek-inset,0px))')
    expect(plain(declared(app, '.q-stage .q-layer', 'right')!)).toBe('calc(var(--q-gap) + var(--peek-inset,0px))')
  })

  it.each(Object.entries(WIDTHS))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    expect(quantum(token).map(plain)).toEqual([literal])
  })

  it.each(Object.entries(EXZED_WIDTHS))('eX-Zed sets %s to %s (elastic 1080 to 1620 for every layer; 96px of background each side, 24px at the least)', (token, size) => {
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

describe('size tokens: the peek cascade of the covered layers (design, answer 4)', () => {
  const QUANTUM_PEEK = { '--peek-rise': '37px', '--peek-scale-1': '.959', '--peek-scale-2': '.921', '--peek-inset-1': '0px', '--peek-inset-2': '0px' } as const
  const EXZED_PEEK = { '--peek-rise': '40px', '--peek-scale-1': '1', '--peek-scale-2': '1', '--peek-inset-1': '0px', '--peek-inset-2': '32px' } as const
  const exzed = read('styles/theme/exzed.css')
  const exzedValue = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it.each(Object.entries(QUANTUM_PEEK))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    expect(definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual([literal])
  })

  it.each(Object.entries(EXZED_PEEK))('eX-Zed sets %s to %s (the board: tab tops 40 and 80px up, scale 1, two back 32px in)', (token, value) => {
    expect(exzedValue(token), token).toBe(value)
  })

  it('the entering layer starts where the layer one back is, from the page’s own rise and scale (so a theme’s motion matches its cascade)', () => {
    const css = read('components/quantum/LayerCard/LayerCard.css')
    const from = /@keyframes q-drumIn\s*{\s*from\s*{([^}]*)}/.exec(css)?.[1] ?? ''

    expect(plain(from)).toContain('transform: translateY(calc(-1 * var(--peek-rise))) scale(var(--peek-scale-1))')
  })

  it('eX-Zed’s layer motion is position only: no blurred shadow in the entry and no fade in the tab', () => {
    expect(exzed).toMatch(/html\.theme-exzed:not\(\[data-reduced\]\) \.q-layer\.enter\s*{\s*animation:\s*q-drumIn [^;]+;\s*}/)
    expect(exzed).not.toMatch(/\.q-layer\.enter[^}]*q-drumShadow/)
    expect(exzed).toMatch(/@keyframes q-tabIn-pos\s*{[^}]*translateY\(8px\)[^}]*}[^}]*}/)
    expect(exzed).not.toMatch(/@keyframes q-tabIn-pos[^@]*opacity/)
  })
})

describe('size tokens: the stage’s offsets (Phase 50.1a, design’s answer to the 50.0 measurements: the boards win for eX-Zed)', () => {
  // Quantum: the literals these replaced (STAGE_TOP_PX 15, `bottom: 20px`, a header as tall as its content). eX-Zed: header 64; a lone window's border box at 108
  // (44 under the header), a window over covered layers 96 + 40n (32 + 40n under the header), 24px above the bottom; the ledge shift 0 until Kui (50.4).
  const QUANTUM_STAGE = { '--stage-top': '15px', '--stage-top-stacked': '15px', '--stage-bottom': '20px', '--ledge-shift': '0px', '--header-h': 'auto' } as const
  const EXZED_STAGE = { '--stage-top': '44px', '--stage-top-stacked': '32px', '--stage-bottom': '24px', '--header-h': '64px' } as const
  const exzed = read('styles/theme/exzed.css')
  const exzedValue = (token: string) => new RegExp(`${token}\\s*:\\s*([^;]+);`).exec(exzed)?.[1]?.trim()

  it.each(Object.entries(QUANTUM_STAGE))('Quantum’s %s is exactly the value it replaced', (token, literal) => {
    expect(definitions(token, ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual([literal])
  })

  it.each(Object.entries(EXZED_STAGE))('eX-Zed sets %s to %s (the board)', (token, value) => {
    expect(exzedValue(token), token).toBe(value)
  })

  it('eX-Zed sets the ledge shift to 0 (the contract wants every token replaced); Kui’s skin sets 24px in 50.4', () => {
    expect(exzedValue('--ledge-shift')).toBe('0px')
  })

  it('the layers stand on the bottom gap token, and the header’s height is its own token', () => {
    expect(declared(read('App.css'), '.q-stage .q-layer', 'bottom')).toBe('var(--stage-bottom)')
    expect(declared(read('components/quantum/AppHeader/AppHeader.css'), '.q-appheader', 'height')).toBe('var(--header-h)')
  })

  it('the layers’ top is read from the page, no literal is left in TypeScript', () => {
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'components', 'quantum', 'layerStack', 'layerGeometry.ts'), 'utf8')

    expect(source).not.toMatch(/STAGE_TOP_PX\s*=/)
    expect(source).toMatch(/tokenPx\('--stage-top'/)
    expect(source).toMatch(/tokenPx\('--stage-top-stacked'/)
    expect(source).toMatch(/tokenPx\('--ledge-shift'/)
  })

  it('eX-Zed’s header has no rule under it (the separator art is what sits there) and is as tall as its token', () => {
    expect(exzed).toMatch(/html\.theme-exzed \.q-appheader\s*{[^}]*border-bottom:\s*0;/)
  })
})

describe('size tokens: the cap on the app (design, X-002 and X-006)', () => {
  it('the shell stops at --app-max and is centred, so the stage shows around it; Quantum has none, and eX-Zed 2560px', () => {
    const app = read('App.css')

    expect(declared(app, '.q-shell', 'max-width')).toBe('var(--app-max)')
    expect(declared(app, '.q-shell', 'margin-inline')).toBe('auto')
    expect(definitions('--app-max', ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual(['none'])
    expect(new RegExp('--app-max\\s*:\\s*([^;]+);').exec(read('styles/theme/exzed.css'))?.[1]?.trim()).toBe('2560px')
  })

  it('beyond the cap the page shows the stage’s ground: the skin’s role --zx-stage, with no Quantum colour behind it (49.5)', () => {
    expect(plain(declared(read('styles/theme/exzed.css'), 'html.theme-exzed body', 'background')!)).toBe('var(--zx-stage)')
  })
})

describe('size tokens: the header aligned to the window (design, X-005)', () => {
  const header = () => read('components/quantum/AppHeader/AppHeader.css')
  const exzedGutter = () => new RegExp('--header-gutter\\s*:\\s*([^;]+);').exec(read('styles/theme/exzed.css'))?.[1]?.trim()

  it('the bar keeps its 14px above and below and takes its sides from --header-gutter, 26px in Quantum', () => {
    expect(plain(declared(header(), '.q-appheader', 'padding')!)).toBe('14px var(--header-gutter)')
    expect(definitions('--header-gutter', ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual(['26px'])
  })

  it('eX-Zed’s gutter is the window’s own gap and cap, so the logo and the last button stand on the window’s outer edges', () => {
    // The same gap the stage keeps each layer (App.css), or half of what the cap leaves, whichever is more: the window is centred beyond its cap.
    expect(plain(exzedGutter()!)).toBe(
      'max(max(var(--stage-gap-min),min(var(--stage-gap),calc((100% - var(--layer-min)) / 2))),calc((100% - var(--layer-max)) / 2))',
    )
  })
})

describe('size tokens: the skin menu (Phase 49.9, design X-003: 220px in Quantum, 288px in eX-Zed)', () => {
  it('the popover of the skin menu reads its width from --skin-menu-w, so a theme sets it', () => {
    expect(declared(read('components/quantum/Popover/Popover.css'), '.q-pop.w220', 'width')).toBe('var(--skin-menu-w)')
  })

  it('is Quantum’s 220px, the width it was, and eX-Zed’s 288px', () => {
    expect(definitions('--skin-menu-w', ['styles/quantum/tokens.css', 'styles/theme/contract.css']).map(plain)).toEqual(['220px'])
    expect(new RegExp('--skin-menu-w\\s*:\\s*([^;]+);').exec(read('styles/theme/exzed.css'))?.[1]?.trim()).toBe('288px')
  })
})

describe('size tokens: the kind tag’s column (Phase 49, found at Checkpoint D; design’s Tag card: as wide as the longest tag in the list)', () => {
  it('stays Quantum’s fixed 58px in its own stylesheet', () => {
    expect(declared(read('components/quantum/Marks/Marks.css'), '.q-tag.kind', 'width')).toBe('58px')
  })

  it('is, under eX-Zed, the longest label’s characters times the font’s advance and its tracking, plus the padding and the border', () => {
    expect(plain(declared(read('styles/theme/exzed.css'), 'html.theme-exzed .q-tag.kind', 'width')!)).toBe('calc(var(--kind-ch) * (1ch + .02em) + 18px)')
  })
})
