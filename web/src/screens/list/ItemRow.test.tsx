// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ListItem } from '../../lib/api.js'
import { ItemRow } from './ItemRow.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'
import { openUrl } from '@tauri-apps/plugin-opener'

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }))

afterEach(() => {
  cleanup()
  vi.mocked(openUrl).mockClear()
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
})

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
  yearUnk: 0,
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
  it('marks a length the category guessed with ≈ on the row, and says so on hover (owner, 2026-10-14)', async () => {
    renderRow({ item: { ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true } })

    const length = document.querySelector('.q-mins')!
    expect(length.textContent).toBe('≈2h')
    expect(await hoverTooltip(length)).toBe('This runtime is a rough estimate')
  })

  it('has no mark and no hover on a length that was given', () => {
    renderRow()

    expect(document.querySelector('.q-mins')!.textContent).toBe('51m')
  })

  it('shows only the dash, without the mark, while the length is still being looked up', () => {
    renderRow({ item: { ...ITEM, timeToConsumeIsEstimated: true, runtimePending: true } })

    expect(document.querySelector('.q-mins')!.textContent).toBe('-')
  })

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

  it('marks an item added by hand, when the list mixes hand-added and imported items', () => {
    renderRow({ item: { ...ITEM, source: 'manual' }, showManual: true })

    expect(document.querySelector('.q-manual')).not.toBeNull()
  })

  it('leaves the hand off when the list does not mix (an all-manual list would be a hand on every row)', () => {
    renderRow({ item: { ...ITEM, source: 'manual' } })

    expect(document.querySelector('.q-manual')).toBeNull()
  })

  it('never marks an imported item, mixed list or not', () => {
    renderRow({ item: { ...ITEM, source: 'import' }, showManual: true })

    expect(document.querySelector('.q-manual')).toBeNull()
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

  it('has a drag handle before the checkbox, named for where the item can go', async () => {
    renderRow()
    const handle = document.querySelector('.q-item .q-handle') as HTMLElement

    expect(await hoverTooltip(handle)).toBe('Drag to move across the list')
    expect(handle.nextElementSibling?.getAttribute('role')).toBe('checkbox')

    cleanup()
    renderRow({ item: { ...ITEM, group: 'Season 1' } })
    expect(await hoverTooltip(document.querySelector('.q-item .q-handle')!)).toBe('Drag to reorder within Season 1')
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

  describe('while its length is still being looked up (15.7)', () => {
    it('shows "-" in place of the estimate it carries, and the real length once it has one', () => {
      const pending = { ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, runtimePending: true }
      renderRow({ item: pending })

      expect(screen.getByText('-')).toBeTruthy()
      expect(screen.queryByText('2h')).toBeNull()

      cleanup()
      renderRow({ item: { ...pending, timeToConsumeMinutes: 101, timeToConsumeIsEstimated: false, runtimePending: false } })

      expect(screen.getByText('1h 41m')).toBeTruthy()
      expect(screen.queryByText('-')).toBeNull()
    })

    it('shows an estimate that is not going to be looked up with its ≈', () => {
      renderRow({ item: { ...ITEM, timeToConsumeMinutes: 120, timeToConsumeIsEstimated: true, runtimePending: false } })

      expect(screen.getByText('≈2h')).toBeTruthy()
    })
  })
})

describe('ItemRow: the link to the item’s page at its source (H-002, BL-087)', () => {
  const LINKED: ListItem = { ...ITEM, link: { url: 'https://www.themoviedb.org/movie/603', source: 'TMDB' } }

  it('has no ↗ for an item with no link, or with none asked for', () => {
    renderRow()
    expect(screen.queryByRole('link')).toBeNull()

    cleanup()
    renderRow({ item: { ...ITEM, link: null } })
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('is a link to the page, named for the item and the source, that opens a new tab and hands the page nothing', () => {
    renderRow({ item: LINKED })
    const link = screen.getByRole('link', { name: 'Open Glorious Purpose on TMDB' })

    expect(link.getAttribute('href')).toBe('https://www.themoviedb.org/movie/603')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('sits after the pencil in the title group, which is where the design puts it', () => {
    renderRow({ item: LINKED })
    const body = document.querySelector('.q-item .body')!
    const order = [...body.children].map((child) => child.getAttribute('aria-label') ?? child.className)

    expect(order).toEqual(['tt', 'Details for Glorious Purpose', 'Edit Glorious Purpose', 'Open Glorious Purpose on TMDB'])
  })

  it('says "Open on TMDB" when hovered', async () => {
    renderRow({ item: LINKED })

    expect(await hoverTooltip(screen.getByRole('link'))).toBe('Open on TMDB')
  })

  it('does not toggle the row it sits in when clicked', () => {
    const { onToggle } = renderRow({ item: LINKED })

    fireEvent.click(screen.getByRole('link'))

    expect(onToggle).not.toHaveBeenCalled()
  })

  it('in the desktop app opens the system browser', () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    renderRow({ item: LINKED })

    fireEvent.click(screen.getByRole('link'))

    expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://www.themoviedb.org/movie/603')
  })
})

describe('ItemRow: the year (H-004, H-005)', () => {
  it('says "Release year" for an exact year', async () => {
    renderRow()
    const year = screen.getByText('(2021)')

    expect(year.getAttribute('aria-label')).toBe('Release year')
    expect(await hoverTooltip(year)).toBe('Release year')
  })

  it('shows 199? as (199?) and says it is sometime in the 1990s', async () => {
    renderRow({ item: { ...ITEM, year: 1990, yearUnk: 1 } })
    const year = screen.getByText('(199?)')

    expect(year.getAttribute('aria-label')).toBe('Sometime in the 1990s')
    expect(await hoverTooltip(year)).toBe('Sometime in the 1990s')
  })

  it('shows 19?? as (19??) and says it is sometime in the 1900s', async () => {
    renderRow({ item: { ...ITEM, year: 1900, yearUnk: 2 } })
    const year = screen.getByText('(19??)')

    expect(year.getAttribute('aria-label')).toBe('Sometime in the 1900s')
    expect(await hoverTooltip(year)).toBe('Sometime in the 1900s')
  })

  it('shows nothing for an item with no year', () => {
    renderRow({ item: { ...ITEM, year: null } })

    expect(screen.queryByText(/^\(/)).toBeNull()
  })
})
