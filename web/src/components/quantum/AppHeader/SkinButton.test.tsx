// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { EXZED_SKINS, type ExzedSkin } from '../../../lib/preferences/exzedSkins.js'
import { SKINS } from '../../../lib/preferences/skin.js'
import type { Theme } from '../../../lib/preferences/theme.js'
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
          <SkinButton skin="dark-orange" onSkinChange={vi.fn()} exzedSkin="exzed-1d" onExzedSkinChange={vi.fn()} />
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

/**
 * The header's skin button and menu follow the theme (Phase 49.9, design X-003: the Menu and Header cards): under Quantum the hexagon and the five
 * skins as ever; under eX-Zed the half-bucket swatch of the active eX-Zed skin beside the caret, and a menu of the six, the picked one marked.
 */
describe('the skin button and its menu follow the theme', () => {
  function renderUnder(theme: Theme, exzedSkin: ExzedSkin = 'exzed-1d') {
    const onSkinChange = vi.fn()
    const onExzedSkinChange = vi.fn()
    const view = render(
      <LiveRegionProvider>
        <OverlayManagerProvider>
          <ThemeContext.Provider value={theme}>
            <SkinButton skin="dark-orange" onSkinChange={onSkinChange} exzedSkin={exzedSkin} onExzedSkinChange={onExzedSkinChange} />
          </ThemeContext.Provider>
        </OverlayManagerProvider>
      </LiveRegionProvider>,
    )
    return { ...view, onSkinChange, onExzedSkinChange, button: screen.getByRole('button', { name: 'Skin' }) }
  }

  it('under Quantum shows the hexagon of the active skin and opens the five skins, as before', () => {
    const { button, container } = renderUnder('quantum')

    expect(button.querySelector('.q-hex')?.getAttribute('data-theme')).toBe('dark-orange')
    expect(button.querySelector('.q-zx-swatch')).toBeNull()
    act(() => button.click())

    const rows = within(screen.getByRole('dialog')).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual(['Destiny', 'Jupiter', 'Deluge', 'Romans', 'Jouhou'])
    expect(rows).toHaveLength(SKINS.length)
    expect(container.querySelector('.q-pop .q-zx-swatch')).toBeNull()
  })

  it('under eX-Zed shows the half-bucket swatch of the active eX-Zed skin beside the caret, and no hexagon', () => {
    const { button } = renderUnder('exzed', 'exzed-1e')

    expect(button.querySelector('.q-zx-swatch')?.getAttribute('data-theme')).toBe('exzed-1e')
    expect(button.querySelector('.q-hex')).toBeNull()
    expect(button.querySelector('svg.q-skin-caret')).not.toBeNull()
  })

  it('under eX-Zed opens a menu of the six skins by name, each with its own swatch, the picked one marked', () => {
    const { button } = renderUnder('exzed', 'exzed-1c')
    act(() => button.click())

    const menu = screen.getByRole('dialog')
    const rows = within(menu).getAllByRole('button')
    expect(rows.map((row) => row.textContent)).toEqual(['Lode', 'Focal', 'Glemt', 'Xen', 'Ikigai', 'Lotus'])
    expect(rows.map((row) => row.querySelector('.q-zx-swatch')?.getAttribute('data-theme'))).toEqual([...EXZED_SKINS])
    expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false'])
    expect(within(menu).getByText('Skin')).not.toBeNull()
    expect(menu.querySelector('.q-hex')).toBeNull()
  })

  it('under eX-Zed picking a skin applies it to eX-Zed’s own key, closes the menu and announces it', async () => {
    const { button, onExzedSkinChange, onSkinChange, container } = renderUnder('exzed')
    act(() => button.click())

    act(() => within(screen.getByRole('dialog')).getByText('Lotus').click())

    expect(onExzedSkinChange).toHaveBeenCalledExactlyOnceWith('exzed-1l')
    expect(onSkinChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(container.querySelector('.q-live')?.textContent).toBe('Switched to the Lotus skin'))
  })
})
