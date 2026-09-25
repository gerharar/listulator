// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GroupBlock } from './spine.js'
import { GroupRow } from './GroupRow.js'

afterEach(cleanup)

const BLOCK: GroupBlock = {
  kind: 'group',
  group: { id: 'g1', listId: 'L', name: 'Season 1', orderIndex: 0 },
  items: [],
  done: 2,
  total: 6,
  minutesLeft: 200,
  yearSpan: { from: 2021, to: 2023 },
  allDone: false,
}

function renderRow(block: GroupBlock = BLOCK, overrides: Partial<Parameters<typeof GroupRow>[0]> = {}) {
  const props = {
    block,
    collapsed: false,
    focusable: false,
    onToggle: vi.fn(),
    onFocus: vi.fn(),
    ...overrides,
  }
  render(<GroupRow {...props} />)
  return props
}

describe('GroupRow', () => {
  it('shows its name, its year span and its own progress', () => {
    renderRow()

    expect(screen.getByText('Season 1')).toBeTruthy()
    expect(screen.getByText('(2021–2023)')).toBeTruthy()
    expect(screen.getByText('2/6 (33%)')).toBeTruthy()
    expect(screen.getByText('3h 20m left')).toBeTruthy()
  })

  it('says "All done" instead of the time left when every item is done', () => {
    renderRow({ ...BLOCK, done: 6, minutesLeft: 0, allDone: true })

    expect(screen.getByText('✓ All done')).toBeTruthy()
    expect(screen.queryByText(/left/)).toBeNull()
    expect(document.querySelector('.q-group.complete')).not.toBeNull()
  })

  it('says what state it is in, for assistive tech', () => {
    renderRow()
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    cleanup()
    renderRow(BLOCK, { collapsed: true })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles by click and by Enter or Space', () => {
    const { onToggle } = renderRow()
    const row = screen.getByRole('button')

    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(onToggle).toHaveBeenCalledTimes(3)
    expect(onToggle).toHaveBeenCalledWith(BLOCK.group.name)
  })

  it('shows an empty group as empty, with no time and no "all done"', () => {
    renderRow({ ...BLOCK, done: 0, total: 0, minutesLeft: 0, yearSpan: null, allDone: false })

    expect(screen.getByText('0/0')).toBeTruthy()
    expect(screen.queryByText(/left|All done/)).toBeNull()
    expect(screen.queryByText(/^\(/)).toBeNull()
  })

  it('is a single tab stop only when it is the list’s focusable row, and reports focus', () => {
    const { onFocus } = renderRow(BLOCK, { focusable: true })
    const row = screen.getByRole('button')

    expect(row.tabIndex).toBe(0)
    fireEvent.focus(row)
    expect(onFocus).toHaveBeenCalledWith(BLOCK.group.id)
  })

  it('carries its id for the roving focus', () => {
    renderRow()

    expect((screen.getByRole('button') as HTMLElement).dataset['rowId']).toBe('g1')
  })

  describe('moving', () => {
    const withItems: GroupBlock = { ...BLOCK, items: [{ id: 'i1' } as never] }

    it('has a drag handle when it has items, named for what it does, and none when it is empty', () => {
      renderRow(withItems)
      const handle = document.querySelector('.q-group .q-handle') as HTMLElement
      expect(handle.getAttribute('title')).toBe('Drag to move this group on the list')

      cleanup()
      renderRow(BLOCK)
      expect(document.querySelector('.q-group .q-handle')).toBeNull()
    })

    it('starts a drag from the handle only, and does not toggle the group', () => {
      const onHandlePointerDown = vi.fn()
      const { onToggle } = renderRow(withItems, { onHandlePointerDown })

      fireEvent.pointerDown(document.querySelector('.q-handle')!)
      fireEvent.click(document.querySelector('.q-handle')!)

      expect(onHandlePointerDown).toHaveBeenCalledTimes(1)
      expect(onToggle).not.toHaveBeenCalled()
    })

    it('is a target for a drop under its own key, and shows the drop line where it would land', () => {
      renderRow(withItems, { dropLine: 'after' })
      const row = document.querySelector('.q-group') as HTMLElement

      expect(row.dataset['dragKey']).toBe('g1')
      expect(row.querySelector('.q-dropline.after')).not.toBeNull()

      cleanup()
      renderRow(withItems, { dropLine: 'before' })
      expect(document.querySelector('.q-group .q-dropline')!.classList.contains('after')).toBe(false)
    })

    it('dims while it is the one being dragged, and washes when it has just moved', () => {
      renderRow(withItems, { dragging: true, pulse: true })

      const row = document.querySelector('.q-group')!
      expect(row.classList.contains('dragging')).toBe(true)
      expect(row.classList.contains('pulse')).toBe(true)
    })
  })
})
