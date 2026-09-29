// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ListMorePopover, type ListMorePopoverProps } from './ListMorePopover.js'

afterEach(cleanup)

const ready = (removed: number, restored: number, doneCleared: number) => ({
  state: 'ready' as const,
  data: { removed, restored, doneCleared, followUpCheck: false },
})

function renderPopover(overrides: Partial<ListMorePopoverProps> = {}) {
  const props: ListMorePopoverProps = {
    mode: 'menu',
    source: 'api',
    title: 'Loki',
    itemCount: 7,
    doneCount: 3,
    preview: ready(0, 0, 0),
    onMode: vi.fn(),
    onDownload: vi.fn(),
    onCopy: vi.fn(),
    onSortNow: vi.fn(),
    onResetOrder: vi.fn(),
    onResetEverything: vi.fn(),
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

const button = (name: string) => screen.getByRole('button', { name })

describe('ListMorePopover', () => {
  describe('the menu', () => {
    it('lists Edit, Export, Reorder, Reset and Delete, in the prototype’s words and order', () => {
      renderPopover()

      const names = screen.getAllByRole('button').map((b) => b.textContent)
      expect(names.filter((n) => n !== 'anchor')).toEqual([
        'Edit List',
        'Export List',
        'Reorder List',
        'Reset List',
        'Delete List',
      ])
    })

    it('has no Reset on a hand-made list: it has no arrived state to return to', () => {
      renderPopover({ source: 'manual' })

      expect(screen.queryByRole('button', { name: 'Reset List' })).toBeNull()
      expect(button('Reorder List')).toBeTruthy()
    })

    it('goes to whichever the reader picks', () => {
      const { onMode } = renderPopover()

      for (const name of ['Edit List', 'Export List', 'Reorder List', 'Reset List', 'Delete List']) {
        fireEvent.click(button(name))
      }

      expect(vi.mocked(onMode).mock.calls).toEqual([['edit'], ['export'], ['reorder'], ['reset'], ['delete']])
    })
  })

  describe('export', () => {
    it('says what a file holds, and offers Download and Copy', () => {
      const { onDownload, onCopy } = renderPopover({ mode: 'export' })

      expect(screen.getByText(/progress is not included/i)).toBeTruthy()
      fireEvent.click(button('Download File'))
      fireEvent.click(button('Copy To Clipboard'))

      expect(onDownload).toHaveBeenCalledTimes(1)
      expect(onCopy).toHaveBeenCalledTimes(1)
    })
  })

  describe('reorder', () => {
    it('asks first, says what it does and that it is one-off, and only then sorts', () => {
      const { onSortNow, onDismiss } = renderPopover({ mode: 'reorder' })

      expect(screen.getByText('Sort this list chronologically?')).toBeTruthy()
      expect(screen.getByText(/Groups are moved as blocks by their earliest item/)).toBeTruthy()
      expect(screen.getByText(/does not block manual reordering later/)).toBeTruthy()
      expect(onSortNow).not.toHaveBeenCalled()

      fireEvent.click(button('Cancel'))
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onSortNow).not.toHaveBeenCalled()

      fireEvent.click(button('Reorder'))
      expect(onSortNow).toHaveBeenCalledTimes(1)
    })
  })

  describe('reset', () => {
    it('asks in words, and says where the list goes back to', () => {
      renderPopover({ mode: 'reset', source: 'canonical' })
      expect(screen.getByText('Reset this list to its virgin state?')).toBeTruthy()
      expect(screen.getByText(/canonical list from the List Vault/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'reset', source: 'file' })
      expect(screen.getByText(/file you imported/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'reset', source: 'api' })
      expect(screen.getByText(/the list you got from search/)).toBeTruthy()
    })

    it('states the cost in words: what goes, what comes back, what is un-ticked', () => {
      renderPopover({ mode: 'reset', preview: ready(3, 1, 12) })

      expect(
        screen.getByText('3 items you added will be removed, 1 item you removed will come back and 12 done marks will be cleared.'),
      ).toBeTruthy()
    })

    it('says only what applies, and says so when nothing does', () => {
      renderPopover({ mode: 'reset', preview: ready(0, 2, 0) })
      expect(screen.getByText('2 items you removed will come back.')).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'reset', preview: ready(0, 0, 0) })
      expect(screen.getByText('Stuff you added, removed or marked done is not affected.')).toBeTruthy()
    })

    it('waits for the numbers before Reset, but not before Reset the order', () => {
      renderPopover({ mode: 'reset', preview: { state: 'loading' } })

      expect((button('Reset') as HTMLButtonElement).disabled).toBe(true)
      expect((button('Reset the order') as HTMLButtonElement).disabled).toBe(false)
      expect(screen.getByText(/Working out what would change/)).toBeTruthy()
    })

    it('still lets you reset when the numbers could not be worked out, and says so', () => {
      const { onResetEverything } = renderPopover({
        mode: 'reset',
        preview: { state: 'failed', message: 'Source is down' },
      })

      expect(screen.getByText(/Could not work out what would change \(Source is down\)/)).toBeTruthy()
      fireEvent.click(button('Reset'))
      expect(onResetEverything).toHaveBeenCalledTimes(1)
    })

    it('the two buttons do the two things, and the dialog says nothing about how long Undo lasts', () => {
      const { onResetOrder, onResetEverything } = renderPopover({ mode: 'reset', preview: ready(1, 0, 0) })
      expect(screen.queryByText(/Undo is offered/)).toBeNull()

      fireEvent.click(button('Reset the order'))
      expect(onResetOrder).toHaveBeenCalledTimes(1)
      expect(onResetEverything).not.toHaveBeenCalled()

      fireEvent.click(button('Reset'))
      expect(onResetEverything).toHaveBeenCalledTimes(1)
    })
  })

  describe('delete', () => {
    it('asks in words and states the cost before the buttons', () => {
      renderPopover({ mode: 'delete' })

      expect(screen.getByText('Delete “Loki”?')).toBeTruthy()
      expect(screen.getByText('7 items (3 done) will be gone like a turd in the wind')).toBeTruthy()
    })

    it('says so for a single item, and for an empty list', () => {
      renderPopover({ mode: 'delete', itemCount: 1, doneCount: 1 })
      expect(screen.getByText(/^1 item \(1 done\) will be gone/)).toBeTruthy()

      cleanup()
      renderPopover({ mode: 'delete', itemCount: 0, doneCount: 0 })
      expect(screen.getByText('The list is empty.')).toBeTruthy()
    })

    it('Keep leaves the list alone; Delete list deletes', () => {
      const { onDelete, onDismiss } = renderPopover({ mode: 'delete' })

      fireEvent.click(button('Keep List'))
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onDelete).not.toHaveBeenCalled()

      fireEvent.click(button('Delete List'))
      expect(onDelete).toHaveBeenCalledTimes(1)
    })
  })

  it('shows how many items the list has on the popover’s head row, in every mode', () => {
    for (const mode of ['export', 'reorder', 'reset', 'delete'] as const) {
      renderPopover({ mode })
      expect(screen.getByText('7 items')).toBeTruthy()
      cleanup()
    }
  })

  it('clicking away closes it, in every mode', () => {
    for (const mode of ['menu', 'export', 'reorder', 'reset', 'delete'] as const) {
      const { onDismiss } = renderPopover({ mode })
      fireEvent.click(document.querySelector('.q-catcher')!)
      expect(onDismiss).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })

  it('is the narrow width for the menu and the list width for the modes', () => {
    renderPopover({ mode: 'menu' })
    expect(document.querySelector('.q-pop')!.classList.contains('w240')).toBe(true)

    for (const mode of ['export', 'reorder', 'reset', 'delete'] as const) {
      cleanup()
      renderPopover({ mode })
      expect(document.querySelector('.q-pop')!.classList.contains('w320')).toBe(true)
    }
  })
})
