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

describe('eX-Zed’s window border (D54)', () => {
  it('is 4px frame-hi on every window', () => {
    expect(body('html.theme-exzed .q-layer')).toMatch(/border:\s*4px solid var\(--zx-frame-hi\);/)
  })

  it('takes the width the app sets (`--q-bw`, always set with `.reach`) for a window whose rail hangs outside', () => {
    expect(body('html.theme-exzed .q-layer.reach')).toMatch(/border-width:\s*var\(--q-bw\);/)
  })
})
