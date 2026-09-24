// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader.js'
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
  it('renders the wordmark and a disabled Settings button', () => {
    render(
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={vi.fn()} />
      </Providers>,
    )

    expect(screen.getByRole('img', { name: 'Listulator' })).not.toBeNull()
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.hasAttribute('disabled')).toBe(true)
  })

  it('opens the skin menu, picks a skin, and announces it in the live region', async () => {
    const onSkinChange = vi.fn()
    const { container } = render(
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={onSkinChange} />
      </Providers>,
    )

    act(() => screen.getByRole('button', { name: 'Skin' }).click())

    const menu = screen.getByRole('dialog')
    act(() => within(menu).getByText('Dark blue').click())

    expect(onSkinChange).toHaveBeenCalledExactlyOnceWith('dark-blue')
    expect(screen.queryByRole('dialog')).toBeNull() // menu closed
    await waitFor(() => {
      expect(container.querySelector('.q-live')?.textContent).toBe(
        'Switched to the Dark blue skin.',
      )
    })
  })

  it('marks the current skin with aria-current in the menu', () => {
    render(
      <Providers>
        <AppHeader skin="dark-blue" onSkinChange={vi.fn()} />
      </Providers>,
    )

    act(() => screen.getByRole('button', { name: 'Skin' }).click())

    const current = screen.getByRole('button', { name: 'Dark blue' })
    expect(current.getAttribute('aria-current')).toBe('true')
  })
})
