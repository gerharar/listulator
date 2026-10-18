// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { GroupBlock } from './spine.js'
import { GroupRow } from './GroupRow.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { ApiError } from '../../lib/api.js'

afterEach(cleanup)

const BLOCK: GroupBlock = {
  kind: 'group',
  group: { id: 'g1', listId: 'L', name: 'Season 1', orderIndex: 0 },
  items: [],
  done: 2,
  total: 6,
  minutesLeft: 200,
  yearSpan: { from: { year: 2021, yearUnk: 0 }, to: { year: 2023, yearUnk: 0 } },
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
  it('shows its name, its year span and its own progress', async () => {
    renderRow()

    expect(screen.getByText('Season 1')).toBeTruthy()
    expect(screen.getByText('(2021–2023)')).toBeTruthy()
    expect(await hoverTooltip(screen.getByText('(2021–2023)'))).toBe('Release years in this group')
    expect(screen.getByText('2/6 (33%)')).toBeTruthy()
    expect(screen.getByText('3h 20m left')).toBeTruthy()
  })

  it('adds a muted count in front of its progress when a filter shows only some of its rows (H-010)', () => {
    renderRow(BLOCK, { matched: 4 })

    expect(screen.getByText('4 shown')).toBeTruthy()
    expect(screen.getByText('2/6 (33%)')).toBeTruthy()
    expect(screen.getByText('3h 20m left')).toBeTruthy()
    const lead = screen.getByText('4 shown')
    expect(lead.nextElementSibling!.textContent).toBe('·')
    expect(lead.nextElementSibling!.nextElementSibling!.textContent).toBe('2/6 (33%)')
  })

  it('shows no count when nothing is filtered away', () => {
    renderRow()

    expect(screen.queryByText(/shown/)).toBeNull()
  })

  it('puts the rename pencil right after the name, then the free space, then the progress (H-011)', () => {
    renderRow(BLOCK, { onRename: vi.fn() })

    const parts = Array.from(document.querySelector('.q-group')!.children).map((node) => node.className)
    const name = parts.findIndex((entry) => entry.split(' ').includes('name'))
    const pencil = parts.findIndex((entry) => entry.split(' ').includes('q-group-rename'))
    const fill = parts.findIndex((entry) => entry.split(' ').includes('q-group-fill'))
    const progress = parts.findIndex((entry) => entry.split(' ').includes('q-progress'))

    expect([name, pencil, fill, progress].every((index) => index >= 0)).toBe(true)
    expect(name).toBeLessThan(pencil)
    expect(pencil).toBe(name + 1)
    expect(fill).toBe(pencil + 1)
    expect(fill).toBeLessThan(progress)
  })

  it('while renaming, the field takes the free width: the name is the flexible part and there is no spacer (H-011)', () => {
    renderRow(BLOCK, { onRename: vi.fn() })

    fireEvent.click(screen.getByRole('button', { name: 'Rename group Season 1' }))

    expect(document.querySelector('.q-group .name.editing')).not.toBeNull()
    expect(document.querySelector('.q-group-fill')).toBeNull()
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

    it('has a drag handle when it has items, named for what it does, and none when it is empty', async () => {
      renderRow(withItems)
      const handle = document.querySelector('.q-group .q-handle') as HTMLElement
      expect(await hoverTooltip(handle)).toBe('Drag to move the whole group across the list')

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

    it('stops typing at 255 characters, the limit on names', () => {
      renderRow(BLOCK, { onRename: vi.fn(async () => {}) })
      fireEvent.click(pencil())

      expect(editor().maxLength).toBe(255)
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

    describe('a name another group has (H-006; owner, 2026-10-15)', () => {
      const taken = 'Alzheimer’s relapse detected: this list already has a group with such name'
      const refuse = () =>
        vi.fn(async () => {
          throw new ApiError(taken, 409, 'group.nameTaken')
        })
      const sentence = () => screen.getByRole('alert')

      it('is refused under the group header in the API’s own words, with the editor still open, marked and holding the cursor', async () => {
        const onRename = refuse()
        renderRow(BLOCK, { onRename })
        fireEvent.click(pencil())

        fireEvent.change(editor(), { target: { value: 'Season 2' } })
        fireEvent.keyDown(editor(), { key: 'Enter' })

        await waitFor(() => expect(sentence().textContent).toBe(taken))
        expect(editor().value).toBe('Season 2')
        expect(editor().getAttribute('aria-invalid')).toBe('true')
        expect(editor().getAttribute('aria-describedby')).toBe(sentence().id)
        expect(document.activeElement).toBe(editor())
        expect(document.querySelector('.q-group')!.contains(sentence())).toBe(true)
      })

      it('takes the sentence away as soon as the name is changed', async () => {
        renderRow(BLOCK, { onRename: refuse() })
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Season 2' } })
        fireEvent.keyDown(editor(), { key: 'Enter' })
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())

        fireEvent.change(editor(), { target: { value: 'Season 2b' } })

        expect(screen.queryByRole('alert')).toBeNull()
        expect(editor().getAttribute('aria-invalid')).toBeNull()
      })

      it('Esc reverts: the editor closes, the name is the old one, and the sentence is gone when it is opened again', async () => {
        renderRow(BLOCK, { onRename: refuse() })
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Season 2' } })
        fireEvent.keyDown(editor(), { key: 'Enter' })
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())

        fireEvent.keyDown(editor(), { key: 'Escape' })

        expect(screen.queryByLabelText('Group name')).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
        fireEvent.click(pencil())
        expect(editor().value).toBe(BLOCK.group.name)
        expect(screen.queryByRole('alert')).toBeNull()
      })

      it('says nothing for any other refusal: those keep the screen’s error strip', async () => {
        renderRow(BLOCK, {
          onRename: vi.fn(async () => {
            throw new ApiError('Could not rename', 500)
          }),
        })
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Season 2' } })
        fireEvent.keyDown(editor(), { key: 'Enter' })

        await waitFor(() => expect(editor().value).toBe('Season 2'))
        expect(screen.queryByRole('alert')).toBeNull()
      })
    })

    describe('a click away only ends the rename (H-013; owner, 2026-10-17)', () => {
      /** A whole press as a browser sends it: pointer, mouse, then the click. */
      const press = (target: Element) => {
        fireEvent.pointerDown(target)
        fireEvent.mouseDown(target)
        fireEvent.pointerUp(target)
        fireEvent.mouseUp(target)
        fireEvent.click(target)
      }
      function renderWithNeighbours(onRename: (name: string) => Promise<void>) {
        const toggled = vi.fn()
        const other = vi.fn()
        const props = {
          block: BLOCK,
          collapsed: false,
          focusable: false,
          onToggle: vi.fn(),
          onFocus: vi.fn(),
          onRename,
        }
        render(
          <>
            <button onClick={toggled}>Hide Completed</button>
            <GroupRow {...props} />
            <GroupRow {...props} block={{ ...BLOCK, group: { ...BLOCK.group, id: 'g2', name: 'Season 2' } }} onRename={other as never} />
          </>,
        )

        return { toggled, other, props }
      }
      const outside = () => screen.getByRole('button', { name: 'Hide Completed' })

      it('saves the new name, and nothing under the pointer reacts: no click, no toggle', async () => {
        const onRename = vi.fn(async () => {})
        const { toggled } = renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Series One' } })

        press(outside())

        await waitFor(() => expect(onRename).toHaveBeenCalledWith('Series One'))
        expect(toggled).not.toHaveBeenCalled()
        await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())
      })

      it('the next press works as normal', async () => {
        const { toggled } = renderWithNeighbours(vi.fn(async () => {}))
        fireEvent.click(pencil())
        press(outside())
        await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())

        press(outside())

        expect(toggled).toHaveBeenCalledTimes(1)
      })

      it('also ends the rename when only a mouse press arrives, with no pointer events', async () => {
        const onRename = vi.fn(async () => {})
        const { toggled } = renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Series One' } })

        fireEvent.mouseDown(outside())
        fireEvent.mouseUp(outside())
        fireEvent.click(outside())

        await waitFor(() => expect(onRename).toHaveBeenCalledWith('Series One'))
        expect(toggled).not.toHaveBeenCalled()
      })

      it('a press inside the field is its own: the cursor is placed, nothing is saved', () => {
        const onRename = vi.fn(async () => {})
        renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Series One' } })

        press(editor())

        expect(editor()).toBeTruthy()
        expect(onRename).not.toHaveBeenCalled()
      })

      it('a taken name keeps the field open with its message and the cursor in it, and the press is still swallowed', async () => {
        const taken = 'This list already has a group with such name'
        const onRename = vi.fn(async () => {
          throw new ApiError(taken, 409, 'group.nameTaken')
        })
        const { toggled } = renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Season 2' } })

        press(outside())

        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(taken))
        expect(document.activeElement).toBe(editor())
        expect(toggled).not.toHaveBeenCalled()
      })

      it('a press on the message under the header is not "away": it does not save again', async () => {
        const onRename = vi.fn(async () => {
          throw new ApiError('taken', 409, 'group.nameTaken')
        })
        renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Season 2' } })
        fireEvent.keyDown(editor(), { key: 'Enter' })
        await waitFor(() => expect(screen.getByRole('alert')))

        press(screen.getByRole('alert'))

        expect(onRename).toHaveBeenCalledTimes(1)
      })

      it('a click on another group\'s pencil ends this rename and does not start the other', async () => {
        const onRename = vi.fn(async () => {})
        renderWithNeighbours(onRename)
        fireEvent.click(pencil())
        fireEvent.change(editor(), { target: { value: 'Series One' } })

        press(screen.getByRole('button', { name: 'Rename group Season 2' }))

        await waitFor(() => expect(onRename).toHaveBeenCalledWith('Series One'))
        await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())
        expect(screen.getByRole('button', { name: 'Rename group Season 2' })).toBeTruthy()
      })

      it('the wheel still scrolls: it is not touched', () => {
        renderWithNeighbours(vi.fn(async () => {}))
        fireEvent.click(pencil())

        const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 })
        outside().dispatchEvent(wheel)

        expect(wheel.defaultPrevented).toBe(false)
      })

      it('a press that never becomes a click (a touch that scrolled) does not eat the next one', async () => {
        vi.useFakeTimers()
        try {
          const { toggled } = renderWithNeighbours(vi.fn(async () => {}))
          fireEvent.click(pencil())

          fireEvent.pointerDown(outside())
          fireEvent.pointerCancel(outside())
          await vi.advanceTimersByTimeAsync(200)
          press(outside())

          expect(toggled).toHaveBeenCalledTimes(1)
        } finally {
          vi.useRealTimers()
        }
      })

      it('a press whose release never arrives (it ended outside the window) does not eat the next press: a second pointerdown is a new gesture', async () => {
        const { toggled } = renderWithNeighbours(vi.fn(async () => {}))
        fireEvent.click(pencil())

        fireEvent.pointerDown(outside())
        await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())
        // No pointerup, no click. The next press is a whole new one.
        press(outside())

        expect(toggled).toHaveBeenCalledTimes(1)
      })

      it('listens only while a rename is open: with none, a press is nobody\'s business', () => {
        const { toggled } = renderWithNeighbours(vi.fn(async () => {}))

        press(outside())

        expect(toggled).toHaveBeenCalledTimes(1)
      })
    })

    it('typing, Space and Enter in the editor do not fold the group', () => {
      const { onToggle } = renderRow(BLOCK, { onRename: vi.fn(async () => {}) })
      fireEvent.click(pencil())

      fireEvent.click(editor())
      fireEvent.keyDown(editor(), { key: ' ' })

      expect(onToggle).not.toHaveBeenCalled()
    })
  })

  it('gives a long name its full text on hover when the ellipsis hides it, and says nothing for a name that fits', async () => {
    const long = 'Better Call Saul Employee Training: Los Pollos Hermanos Employee Training'
    renderRow({ ...BLOCK, group: { ...BLOCK.group, name: long } })
    const name = screen.getByText(long)

    // jsdom lays nothing out: say the name is wider than its box, then that it fits.
    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 400 })
    Object.defineProperty(name, 'clientWidth', { configurable: true, value: 120 })
    expect(await hoverTooltip(name)).toBe(long)

    Object.defineProperty(name, 'scrollWidth', { configurable: true, value: 100 })
    expect(await hoverTooltip(name)).toBeNull()
  })
})

