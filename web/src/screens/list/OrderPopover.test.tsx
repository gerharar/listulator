// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { OrderPopover, type OrderPopoverProps } from './OrderPopover.js'

afterEach(cleanup)

function renderPopover(overrides: Partial<OrderPopoverProps> = {}) {
  const props: OrderPopoverProps = {
    mode: 'menu',
    source: 'api',
    preview: { state: 'ready', data: { removed: 0, restored: 0, doneCleared: 0, followUpCheck: true } },
    onSort: vi.fn(),
    onOpenReset: vi.fn(),
    onResetOrder: vi.fn(),
    onResetEverything: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
    anchorEl: null,
  }

  function Harness() {
    const ref = useRef<HTMLButtonElement>(null)
    const [, force] = useReducer((n: number) => n + 1, 0)
    useLayoutEffect(() => force(), [])

    return (
      <>
        <button ref={ref}>anchor</button>
        <OrderPopover {...props} anchorEl={ref.current} />
      </>
    )
  }
  render(
    <OverlayManagerProvider>
      <Harness />
    </OverlayManagerProvider>,
  )

  return props
}

const ready = (removed: number, restored: number, doneCleared: number) => ({
  state: 'ready' as const,
  data: { removed, restored, doneCleared, followUpCheck: false },
})

describe('OrderPopover', () => {
  describe('the menu', () => {
    it('offers Sort chronologically, and Reset to the source on a list that has a source', () => {
      renderPopover()

      expect(screen.getByRole('button', { name: 'Sort chronologically' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Reset to the source' })).toBeTruthy()
    })

    it('offers no Reset on a hand-made list: it has no arrived state to return to', () => {
      renderPopover({ source: 'manual' })

      expect(screen.getByRole('button', { name: 'Sort chronologically' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Reset to the source' })).toBeNull()
    })

    it('sorts at once, with no confirmation', () => {
      const { onSort } = renderPopover()

      fireEvent.click(screen.getByRole('button', { name: 'Sort chronologically' }))

      expect(onSort).toHaveBeenCalledTimes(1)
    })

    it('opens the Reset question', () => {
      const { onOpenReset } = renderPopover()

      fireEvent.click(screen.getByRole('button', { name: 'Reset to the source' }))

      expect(onOpenReset).toHaveBeenCalledTimes(1)
    })
  })

  describe('the Reset question', () => {
    it('asks in words, and says where the list goes back to', () => {
      renderPopover({ mode: 'reset', source: 'canonical', preview: ready(0, 0, 0) })
      expect(screen.getByText('Reset this list to the source?')).toBeTruthy()
      expect(screen.getByText(/live file in the community library/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'reset', source: 'file', preview: ready(0, 0, 0) })
      expect(screen.getByText(/file you imported/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'reset', source: 'api', preview: ready(0, 0, 0) })
      expect(screen.getByText(/how this list arrived/)).toBeTruthy()
    })

    it('states the cost in words before the buttons: what goes, what comes back, what is un-ticked', () => {
      renderPopover({ mode: 'reset', preview: ready(3, 1, 12) })

      expect(
        screen.getByText('3 items you added will be removed, 1 item you removed will come back and 12 done marks will be cleared.'),
      ).toBeTruthy()
    })

    it('says only what applies', () => {
      renderPopover({ mode: 'reset', preview: ready(0, 2, 0) })

      expect(screen.getByText('2 items you removed will come back.')).toBeTruthy()
    })

    it('says so when nothing changes but the order', () => {
      renderPopover({ mode: 'reset', preview: ready(0, 0, 0) })

      expect(screen.getByText('Nothing you added, removed or marked done is affected.')).toBeTruthy()
    })

    it('waits for the numbers before it lets you reset everything, but not before Reset the order', () => {
      renderPopover({ mode: 'reset', preview: { state: 'loading' } })

      expect((screen.getByRole('button', { name: 'Reset everything' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Reset the order' }) as HTMLButtonElement).disabled).toBe(false)
      expect(screen.getByText(/Working out what would change/)).toBeTruthy()
    })

    it('still lets you reset when the numbers could not be worked out, and says so', () => {
      const { onResetEverything } = renderPopover({ mode: 'reset', preview: { state: 'failed', message: 'Source is down' } })

      expect(screen.getByText(/Could not work out what would change/)).toBeTruthy()
      expect(screen.getByText(/Source is down/)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Reset everything' }))
      expect(onResetEverything).toHaveBeenCalledTimes(1)
    })

    it('the two buttons do the two things', () => {
      const { onResetOrder, onResetEverything } = renderPopover({ mode: 'reset', preview: ready(1, 0, 0) })

      fireEvent.click(screen.getByRole('button', { name: 'Reset the order' }))
      expect(onResetOrder).toHaveBeenCalledTimes(1)
      expect(onResetEverything).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Reset everything' }))
      expect(onResetEverything).toHaveBeenCalledTimes(1)
    })

    it('mentions Undo', () => {
      renderPopover({ mode: 'reset', preview: ready(0, 0, 0) })

      expect(screen.getByText(/Undo is offered for 8 seconds/)).toBeTruthy()
    })
  })

  it('clicking away closes it', () => {
    const { onDismiss } = renderPopover()

    fireEvent.click(document.querySelector('.q-catcher')!)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('is 300 wide for the menu and 340 for the Reset question', () => {
    renderPopover()
    expect(document.querySelector('.q-pop')!.classList.contains('w300')).toBe(true)

    cleanup()
    renderPopover({ mode: 'reset' })
    expect(document.querySelector('.q-pop')!.classList.contains('w340')).toBe(true)
  })
})
