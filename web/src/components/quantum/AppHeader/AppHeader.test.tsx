// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader.js'
import type { AppQuit } from '../../../lib/appQuit.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'

afterEach(cleanup)

function Providers({ children }: { children: ReactNode }) {
  return (
    <LiveRegionProvider>
      <OverlayManagerProvider>{children}</OverlayManagerProvider>
    </LiveRegionProvider>
  )
}

describe('AppHeader', () => {
  it('renders the wordmark and a Settings button that opens Settings', () => {
    const onSettings = vi.fn()
    render(
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={onSettings} onAbout={vi.fn()} />
      </Providers>,
    )

    expect(screen.getByRole('img', { name: 'Listulator' })).not.toBeNull()
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.hasAttribute('disabled')).toBe(false)

    act(() => settings.click())

    expect(onSettings).toHaveBeenCalledOnce()
  })

  it('has an About button straight after Settings that opens About', () => {
    const onAbout = vi.fn()
    render(
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={vi.fn()} onAbout={onAbout} />
      </Providers>,
    )

    const settings = screen.getByRole('button', { name: 'Settings' })
    const about = screen.getByRole('button', { name: 'About' })
    expect(settings.nextElementSibling).toBe(about)

    act(() => about.click())

    expect(onAbout).toHaveBeenCalledOnce()
  })

  it('opens the skin menu, picks a skin, and announces it in the live region', async () => {
    const onSkinChange = vi.fn()
    const { container } = render(
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={onSkinChange} onSettings={vi.fn()} onAbout={vi.fn()} />
      </Providers>,
    )

    act(() => screen.getByRole('button', { name: 'Skin' }).click())

    const menu = screen.getByRole('dialog')
    act(() => within(menu).getByText('Deluge').click())

    expect(onSkinChange).toHaveBeenCalledExactlyOnceWith('dark-blue')
    expect(screen.queryByRole('dialog')).toBeNull() // menu closed
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe(
        'Switched to the Deluge skin',
      )
    })
  })

  describe('Quit / Exit (16.2b)', () => {
    function renderWith(quit?: AppQuit) {
      render(
        <Providers>
          <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={vi.fn()} onAbout={vi.fn()} quit={quit} />
        </Providers>,
      )
    }

    it('is not there outside the desktop app', () => {
      renderWith(undefined)

      expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
        'Skin',
        'Settings',
        'About',
      ])
    })

    it('is last, after About, and named Quit on a Mac', () => {
      renderWith({ platform: 'mac', quit: vi.fn() })

      const quit = screen.getByRole('button', { name: 'Quit' })
      expect(screen.getByRole('button', { name: 'About' }).nextElementSibling).toBe(quit)
      expect(quit.nextElementSibling).toBeNull()
    })

    it('asks first, and Cancel leaves the app running', () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'mac', quit })

      act(() => screen.getByRole('button', { name: 'Quit' }).click())

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Quit Listulator?')).not.toBeNull()
      expect(within(dialog).getByText("Everything you've saved stays")).not.toBeNull()

      act(() => within(dialog).getByRole('button', { name: 'Cancel' }).click())

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(quit).not.toHaveBeenCalled()
    })

    it('is named Exit elsewhere, and confirming ends the app', () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'other', quit })

      act(() => screen.getByRole('button', { name: 'Exit' }).click())

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Exit Listulator?')).not.toBeNull()

      act(() => within(dialog).getByRole('button', { name: 'Exit' }).click())

      expect(quit).toHaveBeenCalledOnce()
    })
  })

  it('marks the current skin with aria-current in the menu', () => {
    render(
      <Providers>
        <AppHeader skin="dark-blue" onSkinChange={vi.fn()} onSettings={vi.fn()} onAbout={vi.fn()} />
      </Providers>,
    )

    act(() => screen.getByRole('button', { name: 'Skin' }).click())

    const current = screen.getByRole('button', { name: 'Deluge' })
    expect(current.getAttribute('aria-current')).toBe('true')
  })
})
