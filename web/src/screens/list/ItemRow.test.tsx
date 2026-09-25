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
      expect(screen.getByRole('button', { name: 'Remove Glorious Purpose' })).toBeTruthy()
    })

    it('each calls back with the item and its own button, and does not toggle the row', () => {
      const props = renderRow()

      for (const [name, handler] of [
        ['Details for Glorious Purpose', props.onInfo],
        ['Edit Glorious Purpose', props.onEdit],
        ['Remove Glorious Purpose', props.onRemove],
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
})
