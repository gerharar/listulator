// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef, type RefObject } from 'react'
import { Popover } from './Popover.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'

/**
 * The real flip/shift decision needs actual browser layout —
 * `@floating-ui/react` reads offsetParent, scrollbar-gutter computed
 * style, and clipping-ancestor intersection, none of which jsdom
 * implements. Confirmed empirically (see docs/DECISIONS.md): even calling
 * `@floating-ui/dom` directly with fully mocked `getBoundingClientRect`
 * produced wrong, inconsistent placements. So this file covers what jsdom
 * *can* verify reliably — real rendering and the real one-popover-at-a-time
 * wiring through `OverlayManagerContext` — not flip geometry.
 */
function useAnchor(): [HTMLButtonElement | null, RefObject<HTMLButtonElement | null>] {
  const ref = useRef<HTMLButtonElement>(null)
  const [, forceRender] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(() => {
    if (ref.current) forceRender()
  }, [])
  return [ref.current, ref]
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Popover rendering', () => {
  it('renders nothing when closed', () => {
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open={false} anchorEl={anchorEl} onDismiss={vi.fn()} width={320}>
            <span>Body</span>
          </Popover>
        </>
      )
    }
    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the card at its requested width, and the catcher, when open', () => {
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={vi.fn()} width={360}>
            <span>Body</span>
          </Popover>
        </>
      )
    }
    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    expect(screen.getByRole('dialog').className).toContain('w360')
    expect(document.querySelector('.q-catcher')).not.toBeNull()
  })

  it('can size to its content instead: the platform card, whose longest name must fit on one line', () => {
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={vi.fn()} width="fit">
            <span>Body</span>
          </Popover>
        </>
      )
    }
    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    expect(screen.getByRole('dialog').className).toContain('wfit')
  })

  it('dismisses on a click on the catcher', () => {
    const onDismiss = vi.fn()
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={onDismiss} width={320}>
            <span>Body</span>
          </Popover>
        </>
      )
    }
    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    document.querySelector<HTMLElement>('.q-catcher')?.click()

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

describe('Popover portal target', () => {
  it('portals to document.body — the tokens live on <html> now, so var(--card) resolves there', () => {
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={vi.fn()} width={320}>
            <span>Body</span>
          </Popover>
        </>
      )
    }

    const { container } = render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    const dialog = screen.getByRole('dialog')
    expect(document.body.contains(dialog)).toBe(true)
    expect(container.contains(dialog)).toBe(false)
  })
})

describe('Popover one-at-a-time wiring', () => {
  it('dismisses the first popover when a second one opens, through the real OverlayManager', () => {
    const dismissFirst = vi.fn()

    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={dismissFirst} width={220}>
            <span>First</span>
          </Popover>
          <Popover open anchorEl={anchorEl} onDismiss={vi.fn()} width={240}>
            <span>Second</span>
          </Popover>
        </>
      )
    }

    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )

    expect(dismissFirst).toHaveBeenCalledOnce()
  })
})

describe('Popover never shows in the wrong place (11.3)', () => {
  function open() {
    function Harness() {
      const [anchorEl, anchorRef] = useAnchor()
      return (
        <>
          <button ref={anchorRef}>Open</button>
          <Popover open anchorEl={anchorEl} onDismiss={vi.fn()} width={320}>
            <span>Body</span>
          </Popover>
        </>
      )
    }
    render(
      <OverlayManagerProvider>
        <Harness />
      </OverlayManagerProvider>,
    )
  }

  it('is invisible until floating-ui has placed it, so it never flashes at the left edge', async () => {
    open()
    const card = screen.getByRole('dialog')

    expect(card.style.opacity).toBe('0')
    await waitFor(() => expect(card.style.opacity).toBe('1'))
  })

  it('caps its height to the room on screen, and scrolls the content inside instead of running off', async () => {
    open()
    const card = screen.getByRole('dialog')

    await waitFor(() => expect(card.style.maxHeight).toMatch(/^\d+(\.\d+)?px$/))
    expect(card.querySelector('.q-pop-scroll')?.textContent).toBe('Body')
  })
})

