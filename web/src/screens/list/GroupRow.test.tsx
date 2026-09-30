// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('has the prototype’s full-size chevron, not the small one (F11)', () => {
    renderRow()

    expect(document.querySelector('.q-chev')!.textContent!.trim()).toBe('▼')
  })

  it('says "All done" instead of the time left when every item is done', () => {
    renderRow({ ...BLOCK, done: 6, minutesLeft: 0, allDone: true })

    expect(screen.getByText('✓ All Done')).toBeTruthy()
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
      expect(handle.getAttribute('title')).toBe('Drag to move the whole group across the list')

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

  it('an empty group has a delete button; pressing it deletes and does not fold the group', () => {
    const props = renderRow({ ...BLOCK, done: 0, total: 0, minutesLeft: 0, yearSpan: null }, { onDelete: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'Delete this empty group' }))

    expect(props.onDelete).toHaveBeenCalledTimes(1)
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  it('a group with items has no delete button', () => {
    renderRow({ ...BLOCK, items: [{ id: 'i1' } as never] }, { onDelete: vi.fn() })

    expect(screen.queryByRole('button', { name: 'Delete this empty group' })).toBeNull()
  })

  it('a group with items has a delete button that asks first: it hands over its own element and does not fold the group', () => {
    const onDeleteWithItems = vi.fn()
    const props = renderRow({ ...BLOCK, items: [{ id: 'i1' } as never] }, { onDeleteWithItems })

    fireEvent.click(screen.getByRole('button', { name: 'Delete group Season 1' }))

    expect(onDeleteWithItems).toHaveBeenCalledWith(expect.any(HTMLElement))
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  describe('renaming (11.18)', () => {
    const pencil = () => screen.getByRole('button', { name: 'Rename group Season 1' })
    const editor = () => screen.getByLabelText('Group name') as HTMLInputElement

    it('offers no rename where the screen gives none', () => {
      renderRow()

      expect(screen.queryByRole('button', { name: /Rename group/ })).toBeNull()
    })

    it('opens an editor on the pencil that holds the whole name, focused, and does not fold the group', () => {
      const { onToggle } = renderRow(BLOCK, { onRename: vi.fn(async () => {}) })

      fireEvent.click(pencil())

      expect(editor().value).toBe('Season 1')
      expect(document.activeElement).toBe(editor())
      expect(onToggle).not.toHaveBeenCalled()
    })

    it('renames on Enter with the name trimmed, then closes the editor', async () => {
      const onRename = vi.fn(async () => {})
      renderRow(BLOCK, { onRename })
      fireEvent.click(pencil())

      fireEvent.change(editor(), { target: { value: '  The Long Season  ' } })
      fireEvent.keyDown(editor(), { key: 'Enter' })

      await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())
      expect(onRename).toHaveBeenCalledWith('The Long Season')
    })

    it('renames when focus leaves the editor too: the click-away is the safety net', async () => {
      const onRename = vi.fn(async () => {})
      renderRow(BLOCK, { onRename })
      fireEvent.click(pencil())

      fireEvent.change(editor(), { target: { value: 'Series One' } })
      fireEvent.blur(editor())

      await waitFor(() => expect(onRename).toHaveBeenCalledWith('Series One'))
    })

    it('Esc puts it back untouched, and asks for nothing', () => {
      const onRename = vi.fn(async () => {})
      renderRow(BLOCK, { onRename })
      fireEvent.click(pencil())

      fireEvent.change(editor(), { target: { value: 'Something else' } })
      fireEvent.keyDown(editor(), { key: 'Escape' })

      expect(screen.queryByLabelText('Group name')).toBeNull()
      expect(screen.getByText('Season 1')).toBeTruthy()
      expect(onRename).not.toHaveBeenCalled()
    })

    it('asks for nothing when the name did not change', () => {
      const onRename = vi.fn(async () => {})
      renderRow(BLOCK, { onRename })
      fireEvent.click(pencil())

      fireEvent.keyDown(editor(), { key: 'Enter' })

      expect(screen.queryByLabelText('Group name')).toBeNull()
      expect(onRename).not.toHaveBeenCalled()
    })

    it('stays open with what was typed when the rename is refused, so it can be fixed', async () => {
      const onRename = vi.fn(async () => {
        throw new Error('taken')
      })
      renderRow(BLOCK, { onRename })
      fireEvent.click(pencil())

      fireEvent.change(editor(), { target: { value: 'Season 2' } })
      fireEvent.keyDown(editor(), { key: 'Enter' })

      await waitFor(() => expect(onRename).toHaveBeenCalled())
      expect(editor().value).toBe('Season 2')
    })

    it('typing, Space and Enter in the editor do not fold the group', () => {
      const { onToggle } = renderRow(BLOCK, { onRename: vi.fn(async () => {}) })
      fireEvent.click(pencil())

      fireEvent.click(editor())
      fireEvent.keyDown(editor(), { key: ' ' })

      expect(onToggle).not.toHaveBeenCalled()
    })
  })

  it('gives a long name its full text on hover, whatever the ellipsis hides', () => {
    const long = 'Better Call Saul Employee Training: Los Pollos Hermanos Employee Training'
    renderRow({ ...BLOCK, group: { ...BLOCK.group, name: long } })

    expect(screen.getByText(long).getAttribute('title')).toBe(long)
  })
})

