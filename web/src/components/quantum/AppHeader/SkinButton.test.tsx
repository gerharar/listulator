// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SkinButton } from './SkinButton.js'

afterEach(cleanup)

/**
 * The skin button's arrow was the text glyph ▼ at 9px in the mono stack. JetBrains Mono has no ▼, so the glyph came from a system
 * fallback font, and on Windows it drew hollow (owner report, 2026-11-06) while every larger arrow drew full. A drawing has no font.
 */
describe('the skin button’s arrow', () => {
  function renderButton() {
    render(
      <LiveRegionProvider>
        <OverlayManagerProvider>
          <SkinButton skin="dark-orange" onSkinChange={vi.fn()} />
        </OverlayManagerProvider>
      </LiveRegionProvider>,
    )
    return screen.getByRole('button', { name: 'Skin' })
  }

  it('is a drawn triangle, hidden from assistive technology', () => {
    const caret = renderButton().querySelector('svg.q-skin-caret')
    expect(caret).not.toBeNull()
    expect(caret?.getAttribute('aria-hidden')).toBe('true')
    expect(caret?.getAttribute('focusable')).toBe('false')
  })

  it('is the picker triangle of canvas H-027, 6 x 5', () => {
    const caret = renderButton().querySelector('svg.q-skin-caret')
    expect(caret?.getAttribute('width')).toBe('6')
    expect(caret?.getAttribute('height')).toBe('5')
  })

  /** H-027 (2026-11-06): centred on the control, no whole-pixel top. The 13px margin and `align-self: flex-start` were that rule. */
  it('is centred by the button, not pushed to a whole-pixel top', () => {
    const css = readFileSync(join(import.meta.dirname, 'AppHeader.css'), 'utf8')
    const rule = /\.q-skin-caret\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).not.toMatch(/align-self/)
    expect(rule).not.toMatch(/margin-top/)
  })

  it('has no font glyph in the button', () => {
    expect(renderButton().textContent).not.toMatch(/[▲▼▶▸▾]/)
  })
})
