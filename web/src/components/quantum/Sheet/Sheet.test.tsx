// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Sheet } from './Sheet.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(
      <OverlayManagerProvider>
        <Sheet open={false} onClose={vi.fn()} title="Finish Him!" explain="Tie up loose ends" />
      </OverlayManagerProvider>,
    )

    expect(screen.queryByText('Finish Him!')).toBeNull()
  })

  it('renders its title, explain and body when open — no scrim element', () => {
    render(
      <OverlayManagerProvider>
        <Sheet open onClose={vi.fn()} title="Finish Him!" explain="Tie up loose ends">
          <span>Top pick</span>
        </Sheet>
      </OverlayManagerProvider>,
    )

    expect(screen.getByText('Finish Him!')).not.toBeNull()
    expect(screen.getByText('Tie up loose ends')).not.toBeNull()
    expect(screen.getByText('Top pick')).not.toBeNull()
  })

  it('closes on a click inside the sheet’s own body — not itself "outside"', () => {
    const onClose = vi.fn()
    render(
      <OverlayManagerProvider>
        <Sheet open onClose={onClose} title="Finish Him!" explain="Tie up loose ends">
          <span>Top pick</span>
        </Sheet>
      </OverlayManagerProvider>,
    )

    fireEvent.pointerDown(screen.getByText('Top pick'))

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a click outside — there is no scrim to catch it', () => {
    const onClose = vi.fn()
    render(
      <OverlayManagerProvider>
        <div>
          <button>Elsewhere</button>
          <Sheet open onClose={onClose} title="Finish Him!" explain="Tie up loose ends" />
        </div>
      </OverlayManagerProvider>,
    )

    fireEvent.pointerDown(screen.getByText('Elsewhere'))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes via its own close button', () => {
    const onClose = vi.fn()
    render(
      <OverlayManagerProvider>
        <Sheet open onClose={onClose} title="Finish Him!" explain="Tie up loose ends" />
      </OverlayManagerProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('hosts a bar between the head and the body when given one', () => {
    render(
      <OverlayManagerProvider>
        <Sheet open onClose={vi.fn()} title="T" explain="E" bar={<span>the bar</span>}>
          <span>the body</span>
        </Sheet>
      </OverlayManagerProvider>,
    )

    const bar = screen.getByText('the bar').parentElement!
    expect(bar.className).toBe('q-sheet-bar')
    expect(bar.nextElementSibling!.className).toBe('q-sheet-body')
  })

  it('does not close for a press inside a popover or its click-away layer, which sit outside it in the DOM', () => {
    const onClose = vi.fn()
    render(
      <OverlayManagerProvider>
        <Sheet open onClose={onClose} title="T" explain="E">
          <span>body</span>
        </Sheet>
        <div className="q-pop">
          <button>inside a popover</button>
        </div>
        <div className="q-catcher" />
        <button>elsewhere</button>
      </OverlayManagerProvider>,
    )

    fireEvent.pointerDown(screen.getByText('inside a popover'))
    fireEvent.pointerDown(document.querySelector('.q-catcher')!)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
