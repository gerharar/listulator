// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ListItem } from '../../lib/api.js'
import { ItemRow } from './ItemRow.js'

afterEach(cleanup)

const ITEM: ListItem = {
  id: 'i1',
  listId: 'L',
  title: 'Glorious Purpose',
  orderIndex: 0,
  timeToConsumeMinutes: 51,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: 2021,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
}

function renderRow(overrides: Partial<Parameters<typeof ItemRow>[0]> = {}) {
  const props = {
    item: ITEM,
    grouped: false,
    focusable: false,
    minutesWidth: 6,
    onToggle: vi.fn(),
    onFocus: vi.fn(),
    onInfo: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    pulse: false,
    ...overrides,
  }
  render(<ItemRow {...props} />)
  return props
}

describe('ItemRow', () => {
  it('shows the title, the year in brackets and the runtime', () => {
    renderRow()

    expect(screen.getByText('Glorious Purpose')).toBeTruthy()
    expect(screen.getByText('(2021)')).toBeTruthy()
    expect(screen.getByText('51m')).toBeTruthy()
  })

  it('shows no year brackets for an item with no year', () => {
    renderRow({ item: { ...ITEM, year: null } })

    expect(screen.queryByText(/^\(/)).toBeNull()
  })

  it('is not done until it has been consumed, and says so in its box', () => {
    renderRow()
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
    expect(document.querySelector('.q-item.is-done')).toBeNull()

    cleanup()
    renderRow({ item: { ...ITEM, consumedAt: '2026-01-01T00:00:00Z' } })
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(document.querySelector('.q-item.is-done')).not.toBeNull()
  })

  it('toggles when the row is clicked', () => {
    const { onToggle } = renderRow()

    fireEvent.click(screen.getByText('Glorious Purpose'))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(ITEM)
  })

  it('toggles once, not twice, when the box itself is clicked', () => {
    const { onToggle } = renderRow()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('toggles from the keyboard with Space or Enter on the row', () => {
    const { onToggle } = renderRow({ focusable: true })
    const row = document.querySelector('.q-item') as HTMLElement

    fireEvent.keyDown(row, { key: ' ' })
    fireEvent.keyDown(row, { key: 'Enter' })

    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('is one tab stop only when it is the focusable row of the list', () => {
    renderRow({ focusable: true })
    expect((document.querySelector('.q-item') as HTMLElement).tabIndex).toBe(0)

    cleanup()
    renderRow({ focusable: false })
    expect((document.querySelector('.q-item') as HTMLElement).tabIndex).toBe(-1)
  })

  it('reports focus, so the list can remember the last-focused row', () => {
    const { onFocus } = renderRow()

    fireEvent.focus(document.querySelector('.q-item') as HTMLElement)

    expect(onFocus).toHaveBeenCalledWith(ITEM)
  })

  it('indents inside a group', () => {
    renderRow({ grouped: true })

    expect(document.querySelector('.q-item.in-group')).not.toBeNull()
  })

  it('marks an item added by hand', () => {
    renderRow({ item: { ...ITEM, source: 'manual' } })

    expect(document.querySelector('.q-manual')).not.toBeNull()
  })

  it('shows the first tag as its kind', () => {
    renderRow({ item: { ...ITEM, tags: ['Album', 'Live'] } })

    expect(screen.getByText('Album')).toBeTruthy()
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('carries its id, for the roving focus to find', () => {
    renderRow()

    expect((document.querySelector('.q-item') as HTMLElement).dataset['rowId']).toBe('i1')
  })

  describe('row buttons (task 10.21)', () => {
    it('has an info, an edit and a remove button, named for the item', () => {
      renderRow()

      expect(screen.getByRole('button', { name: 'Details for Glorious Purpose' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Edit Glorious Purpose' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Delete Glorious Purpose' })).toBeTruthy()
    })

    it('each calls back with the item and its own button, and does not toggle the row', () => {
      const props = renderRow()

      for (const [name, handler] of [
        ['Details for Glorious Purpose', props.onInfo],
        ['Edit Glorious Purpose', props.onEdit],
        ['Delete Glorious Purpose', props.onRemove],
      ] as const) {
        const button = screen.getByRole('button', { name })
        fireEvent.click(button)
        expect(handler).toHaveBeenCalledWith(ITEM, button)
      }

      expect(props.onToggle).not.toHaveBeenCalled()
    })

    it('a key press on a button is not a key press on the row', () => {
      const props = renderRow({ focusable: true })

      fireEvent.keyDown(screen.getByRole('button', { name: 'Edit Glorious Purpose' }), { key: 'Enter' })

      expect(props.onToggle).not.toHaveBeenCalled()
    })

    it('pulses when it was just added, moved or restored', () => {
      renderRow({ pulse: true })

      expect(document.querySelector('.q-item.pulse')).not.toBeNull()
    })
  })

  it('marks an item that arrived with a sync as NEW, and no other', () => {
    renderRow({ item: { ...ITEM, isNew: true } })
    expect(screen.getByText('NEW')).toBeTruthy()

    cleanup()
    renderRow()
    expect(screen.queryByText('NEW')).toBeNull()
  })

  it('keeps ⓘ and ✎ inside the title’s own group, so they get its gap and do not touch the text', () => {
    renderRow({ item: { ...ITEM, isNew: true } })

    const body = document.querySelector('.q-item .body')!
    expect(body.querySelector('button.info')).not.toBeNull()
    expect(body.querySelector('button.edit')).not.toBeNull()
  })

  it('puts the NEW mark after that group, not inside it', () => {
    renderRow({ item: { ...ITEM, isNew: true } })

    const body = document.querySelector('.q-item .body')!
    expect(body.querySelector('.q-new')).toBeNull()
    expect(body.nextElementSibling?.classList.contains('q-new')).toBe(true)
  })

  it('has a drag handle before the checkbox, named for where the item can go', () => {
    renderRow()
    const handle = document.querySelector('.q-item .q-handle') as HTMLElement

    expect(handle.getAttribute('title')).toBe('Drag to move across the list')
    expect(handle.nextElementSibling?.getAttribute('role')).toBe('checkbox')

    cleanup()
    renderRow({ item: { ...ITEM, group: 'Season 1' } })
    expect(document.querySelector('.q-item .q-handle')!.getAttribute('title')).toBe('Drag to reorder within Season 1')
  })

  it('starts a drag from the handle only, and does not toggle the row', () => {
    const onHandlePointerDown = vi.fn()
    const { onToggle } = renderRow({ onHandlePointerDown })

    fireEvent.pointerDown(document.querySelector('.q-handle')!)
    fireEvent.click(document.querySelector('.q-handle')!)

    expect(onHandlePointerDown).toHaveBeenCalledTimes(1)
    expect(onHandlePointerDown.mock.calls[0]![1]).toEqual(ITEM)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('is a target for a drop under its own id, and shows the drop line above or below', () => {
    renderRow({ dropLine: 'before' })
    const row = document.querySelector('.q-item') as HTMLElement

    expect(row.dataset['dragKey']).toBe(ITEM.id)
    expect(row.querySelector('.q-dropline')).not.toBeNull()
    expect(row.querySelector('.q-dropline.after')).toBeNull()

    cleanup()
    renderRow({ dropLine: 'after' })
    expect(document.querySelector('.q-item .q-dropline.after')).not.toBeNull()
  })

  it('dims while it is being dragged', () => {
    renderRow({ dragging: true })

    expect(document.querySelector('.q-item')!.classList.contains('dragging')).toBe(true)
  })
})
