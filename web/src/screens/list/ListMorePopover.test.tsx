// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ListMorePopover, type ListMorePopoverProps } from './ListMorePopover.js'

afterEach(cleanup)

function renderPopover(overrides: Partial<ListMorePopoverProps> = {}) {
  const props: ListMorePopoverProps = {
    mode: 'menu',
    title: 'Loki',
    itemCount: 7,
    doneCount: 3,
    onMode: vi.fn(),
    onDownload: vi.fn(),
    onCopy: vi.fn(),
    onDelete: vi.fn(),
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
        <ListMorePopover {...props} anchorEl={ref.current} />
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

describe('ListMorePopover', () => {
  describe('the menu', () => {
    it('offers Export and Delete', () => {
      renderPopover()

      expect(screen.getByRole('button', { name: 'Export list' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Delete list' })).toBeTruthy()
    })

    it('goes to the mode it is asked for', () => {
      const { onMode } = renderPopover()

      fireEvent.click(screen.getByRole('button', { name: 'Export list' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete list' }))

      expect(vi.mocked(onMode).mock.calls).toEqual([['export'], ['delete']])
    })
  })

  describe('export', () => {
    it('says what a file holds, and offers Download and Copy', () => {
      const { onDownload, onCopy } = renderPopover({ mode: 'export' })

      expect(screen.getByText(/progress is never included/i)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Download file' }))
      fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))

      expect(onDownload).toHaveBeenCalledTimes(1)
      expect(onCopy).toHaveBeenCalledTimes(1)
    })
  })

  describe('delete', () => {
    it('asks in words and states the cost before the buttons', () => {
      renderPopover({ mode: 'delete' })

      expect(screen.getByText('Delete “Loki”?')).toBeTruthy()
      expect(screen.getByText('7 items and 3 marked done go with it. Undo is offered for 8 seconds.')).toBeTruthy()
    })

    it('says so for a single item, and for an empty list', () => {
      renderPopover({ mode: 'delete', itemCount: 1, doneCount: 1 })
      expect(screen.getByText(/^1 item and 1 marked done go with it/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'delete', itemCount: 0, doneCount: 0 })
      expect(screen.getByText('The list is empty. Undo is offered for 8 seconds.')).toBeTruthy()
    })

    it('Keep goes back to nothing being deleted; Delete list deletes', () => {
      const { onDelete, onDismiss } = renderPopover({ mode: 'delete' })

      fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDelete).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Delete list' }))
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('is the narrow width for the menu and the list width for the modes', () => {
    renderPopover({ mode: 'menu' })
    expect(document.querySelector('.q-pop')!.classList.contains('w240')).toBe(true)

    cleanup()
    renderPopover({ mode: 'export' })
    expect(document.querySelector('.q-pop')!.classList.contains('w320')).toBe(true)
  })

  it('clicking away closes it, in every mode', () => {
    for (const mode of ['menu', 'export', 'delete'] as const) {
      const { onDismiss } = renderPopover({ mode })
      fireEvent.click(document.querySelector('.q-catcher')!)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })
})
