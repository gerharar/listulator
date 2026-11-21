import { describe, expect, it } from 'vitest'
import { read } from './cssGuard.js'

/**
 * The window's own border under eX-Zed (57.3a, design's D54), `styles/theme/exzed.css`: 4px `frame-hi` on every screen, as the Window card and every board draw it, in the skin's role and in no
 * literal colour; a list whose rail hangs outside reads the same width from `--q-bw`. Quantum's own border (2px `rule`) is untouched: both rules are under `html.theme-exzed`.
 */
const css = read('styles/theme/exzed.css')
const body = (selector: string) =>
  [...css.matchAll(/([^{}@]+){([^{}]*)}/g)]
    .filter((m) => m[1]!.split(',').some((part) => part.trim() === selector))
    .map((m) => m[2]!)
    .join('')

const rail = read('styles/theme/exzed-rail.css')
const railBody = (selector: string) =>
  [...rail.matchAll(/([^{}@]+){([^{}]*)}/g)]
    .filter((m) => m[1]!.split(',').some((part) => part.trim() === selector))
    .map((m) => m[2]!)
    .join('')

describe('eX-Zed’s window border (D54)', () => {
  it('is 4px frame-hi on every window', () => {
    expect(body('html.theme-exzed .q-layer')).toMatch(/border:\s*4px solid var\(--zx-frame-hi\);/)
  })

  it('takes the width the app sets (`--q-bw`, always set with `.reach`) for a window whose rail hangs outside', () => {
    expect(body('html.theme-exzed .q-layer.reach')).toMatch(/border-width:\s*var\(--q-bw\);/)
  })
})

describe('eX-Zed’s outside jump rail (57.3, D51 and D54)', () => {
  it('has its own double frame: a 4px frame-hi border with no right border, the window’s three rings clipped at its edge, 4px above the list area', () => {
    const rule = railBody('html.theme-exzed .q-rail.q-rail-out')
    expect(rule).toMatch(/top:\s*calc\(-1 \* var\(--q-bw\)\);/)
    expect(rule).toMatch(/box-sizing:\s*content-box;/)
    expect(rule).toMatch(/border:\s*4px solid var\(--zx-frame-hi\);\s*border-right:\s*0;/)
    expect(rule).toMatch(/box-shadow:\s*var\(--e-layer-rest\);/)
    expect(rule).toMatch(/clip-path:\s*inset\(-12px 0 -12px -12px\);/)
  })

  it('turns the window’s frame ring out at the top joint with one 8x8 box on the rail’s container (not on the rail, which clips, and not the ::after the busy scrim has): frame on the left half, paper on the right', () => {
    for (const container of ['.q-list-cols', '.q-preview-lower']) {
      const rule = railBody(`html.theme-exzed ${container}:has(> .q-rail.q-rail-out)::before`)
      expect(rule, container).toMatch(/top:\s*-16px;\s*left:\s*-12px;\s*width:\s*8px;\s*height:\s*8px;/)
      expect(rule, container).toMatch(/linear-gradient\(var\(--zx-frame\), var\(--zx-frame\)\) 0 0 \/ 4px 8px no-repeat,\s*var\(--zx-paper\);/)
    }
    expect(rail).not.toMatch(/\.q-list-cols:has\(> \.q-rail\.q-rail-out\)::after/)
  })
})
