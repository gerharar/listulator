// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppHeader } from './AppHeader.js'
import type { AppQuit } from '../../../lib/appQuit.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'

afterEach(cleanup)

/** The two members of `AppQuit` that keep the window's close held while a run goes on (H-015), as test doubles. */
function held() {
  return {
    holdClose: vi.fn<(held: boolean) => Promise<void>>(() => Promise.resolve()),
    onQuitWhileRunning: vi.fn<(handler: () => void) => Promise<() => void>>(() => Promise.resolve(() => {})),
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <LiveRegionProvider>
      <OverlayManagerProvider>{children}</OverlayManagerProvider>
    </LiveRegionProvider>
  )
}

describe('AppHeader while a whole-list run goes on (H-015)', () => {
  it('shows Settings and About as disabled, each saying what it waits for, and works again when the run ends', () => {
    const onSettings = vi.fn()
    const onAbout = vi.fn()
    const view = (kind?: 'reset' | 'order' | 'undo') => (
      <Providers>
        <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={onSettings} onAbout={onAbout} run={kind ? { kind, listName: 'Loki' } : undefined} />
      </Providers>
    )
    const { rerender } = render(view('reset'))

    for (const name of ['Settings', 'About']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.getAttribute('aria-description')).toBe('Wait until the reset finishes')
    }
    rerender(view('order'))
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-description')).toBe('Wait until the order is restored')
    rerender(view('undo'))
    expect(screen.getByRole('button', { name: 'About' }).getAttribute('aria-description')).toBe('Wait until the undo finishes')

    rerender(view(undefined))
    for (const name of ['Settings', 'About']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.hasAttribute('aria-description')).toBe(false)
    }
    act(() => screen.getByRole('button', { name: 'Settings' }).click())
    expect(onSettings).toHaveBeenCalledOnce()
  })
})

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
    function renderWith(quit?: AppQuit, running = false) {
      const run = running ? ({ kind: 'reset', listName: 'Loki' } as const) : undefined
      render(
        <Providers>
          <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={vi.fn()} onAbout={vi.fn()} quit={quit} run={run} />
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
      renderWith({ platform: 'mac', quit: vi.fn(), ...held() })

      const quit = screen.getByRole('button', { name: 'Quit' })
      expect(screen.getByRole('button', { name: 'About' }).nextElementSibling).toBe(quit)
      expect(quit.nextElementSibling).toBeNull()
    })

    it('asks first, and Cancel leaves the app running', () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'mac', quit, ...held() })

      act(() => screen.getByRole('button', { name: 'Quit' }).click())

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Quit Listulator?')).not.toBeNull()
      expect(within(dialog).getByText("Everything you've saved stays")).not.toBeNull()

      act(() => within(dialog).getByRole('button', { name: 'Cancel' }).click())

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(quit).not.toHaveBeenCalled()
    })

    it('warns while a whole-list run goes on, in design\'s words and naming the list; Keep waiting leaves the app running (H-015)', () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'mac', quit, ...held() }, true)

      act(() => screen.getByRole('button', { name: 'Quit' }).click())

      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Quit while “Loki” is being rewritten?')).not.toBeNull()
      expect(within(dialog).getByText('Quitting now leaves it half-done. It needs juuuust a few more seconds.')).not.toBeNull()
      expect(within(dialog).getByRole('button', { name: 'Quit anyway' })).not.toBeNull()
      expect(within(dialog).queryByText("Everything you've saved stays")).toBeNull()

      act(() => within(dialog).getByRole('button', { name: 'Keep waiting' }).click())

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(quit).not.toHaveBeenCalled()
    })

    it('still lets the person quit anyway while a run goes on, with the system\'s word (Exit elsewhere)', async () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'other', quit, ...held() }, true)

      act(() => screen.getByRole('button', { name: 'Exit' }).click())
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText('Exit while “Loki” is being rewritten?')).not.toBeNull()
      act(() => within(dialog).getByRole('button', { name: 'Exit anyway' }).click())

      await waitFor(() => expect(quit).toHaveBeenCalledOnce())
    })

    describe('the window\'s own close button, Cmd+Q and Alt+F4 while a run goes on (H-015)', () => {
      const RUN = { kind: 'reset', listName: 'Loki' } as const
      const mount = (extra: ReturnType<typeof held>, run: typeof RUN | undefined, quit = vi.fn(() => Promise.resolve())) => {
        const view = (r: typeof RUN | undefined) => (
          <Providers>
            <AppHeader skin="dark-orange" onSkinChange={vi.fn()} onSettings={vi.fn()} onAbout={vi.fn()} quit={{ platform: 'mac', quit, ...extra }} run={r} />
          </Providers>
        )
        const rendered = render(view(run))

        return { quit, rerender: (r: typeof RUN | undefined) => rendered.rerender(view(r)), unmount: rendered.unmount }
      }

      it('holds the window\'s close while the run goes on, renews the hold now and then, and lets go when the run ends', async () => {
        vi.useFakeTimers()
        const extra = held()
        const view = mount(extra, RUN)
        expect(extra.holdClose).toHaveBeenLastCalledWith(true)

        const calls = extra.holdClose.mock.calls.length
        await act(async () => void vi.advanceTimersByTime(11_000))
        expect(extra.holdClose.mock.calls.length).toBeGreaterThan(calls)
        expect(extra.holdClose.mock.calls.every(([isHeld]) => isHeld)).toBe(true)

        view.rerender(undefined)
        expect(extra.holdClose).toHaveBeenLastCalledWith(false)
        vi.useRealTimers()
      })

      it('holds nothing when no run goes on, and lets go if the header goes away mid-run', () => {
        const idle = held()
        mount(idle, undefined)
        expect(idle.holdClose).not.toHaveBeenCalled()
        cleanup()

        const busy = held()
        const view = mount(busy, RUN)
        view.unmount()
        expect(busy.holdClose).toHaveBeenLastCalledWith(false)
      })

      it('a close request from the window opens the Quit question naming the list, with Keep waiting to hand', async () => {
        const extra = held()
        let ask!: () => void
        extra.onQuitWhileRunning.mockImplementation((handler) => {
          ask = handler
          return Promise.resolve(() => {})
        })
        mount(extra, RUN)
        expect(screen.queryByRole('dialog')).toBeNull()

        act(() => ask())

        const dialog = await screen.findByRole('dialog')
        expect(within(dialog).getByText('Quit while “Loki” is being rewritten?')).not.toBeNull()
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Keep waiting' })))
      })

      it('Quit anyway lets go of the hold first, and only then closes the window', async () => {
        const order: string[] = []
        const extra = held()
        extra.holdClose.mockImplementation((isHeld) => {
          order.push(`hold:${isHeld}`)
          return Promise.resolve()
        })
        let ask!: () => void
        extra.onQuitWhileRunning.mockImplementation((handler) => {
          ask = handler
          return Promise.resolve(() => {})
        })
        const quit = vi.fn(() => {
          order.push('quit')
          return Promise.resolve()
        })
        mount(extra, RUN, quit)
        act(() => ask())

        act(() => within(screen.getByRole('dialog')).getByRole('button', { name: 'Quit anyway' }).click())

        await waitFor(() => expect(quit).toHaveBeenCalledOnce())
        expect(order.slice(order.indexOf('hold:false'))).toEqual(['hold:false', 'quit'])
      })

      it('Quit anyway is not undone by the renewal: the hold is not asked for again after it was let go (a run is still going on)', async () => {
        vi.useFakeTimers()
        const calls: boolean[] = []
        const extra = held()
        extra.holdClose.mockImplementation((isHeld) => {
          calls.push(isHeld)
          return Promise.resolve()
        })
        let ask!: () => void
        extra.onQuitWhileRunning.mockImplementation((handler) => {
          ask = handler
          return Promise.resolve(() => {})
        })
        mount(extra, RUN)
        await act(async () => {})
        act(() => ask())
        await act(async () => void within(screen.getByRole('dialog')).getByRole('button', { name: 'Quit anyway' }).click())

        // The run goes on while the window closes: the renewal timer fires, and must not take the close back.
        await act(async () => void vi.advanceTimersByTime(12_000))

        const letGo = calls.lastIndexOf(false)
        expect(letGo).toBeGreaterThanOrEqual(0)
        expect(calls.slice(letGo + 1)).toEqual([])
        vi.useRealTimers()
      })

      it('stops listening when the header goes away', async () => {
        const off = vi.fn()
        const extra = held()
        extra.onQuitWhileRunning.mockResolvedValue(off)
        const view = mount(extra, RUN)
        await act(async () => {})

        view.unmount()

        expect(off).toHaveBeenCalledOnce()
      })
    })

    it('is named Exit elsewhere, and confirming ends the app', () => {
      const quit = vi.fn(() => Promise.resolve())
      renderWith({ platform: 'other', quit, ...held() })

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
