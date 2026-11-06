// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
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

  it('has no font glyph in the button', () => {
    expect(renderButton().textContent).not.toMatch(/[▲▼▶▸▾]/)
  })
})
