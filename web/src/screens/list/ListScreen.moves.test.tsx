// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/** Moving rows on the list screen (task 10.23): Shift+↑↓ and dragging by the handle. */

const store = new Map<string, string>()

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: string) => void store.set(key, value),
  }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), restoreOrder: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'tv', label: 'TV Shows', sortOrder: 1, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
]

const item = (id: string, orderIndex: number, group: string | null = null): ListItem => ({
  id,
  listId: 'L1',
  title: id.toUpperCase(),
  orderIndex,
  timeToConsumeMinutes: 30,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: null,
  group,
  tags: null,
  notes: null,
  isNew: false,
})

/** a, then Season 1 (g1 g2 g3), then b. */
const list = (): MediaListDetail =>
  ({
    id: 'L1',
    title: 'Loki',
    description: null,
    mediaType: 'tv',
    source: 'api',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: [item('a', 0), item('g1', 1, 'Season 1'), item('g2', 2, 'Season 1'), item('g3', 3, 'Season 1'), item('b', 4)],
    groups: [{ id: 'gs', listId: 'L1', name: 'Season 1', orderIndex: 0 } as ListGroup],
  }) as MediaListDetail

let removable: () => void

function Harness() {
  const [shown, setShown] = useState(true)
  removable = () => setShown(false)

  return (
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <button>outside</button>
          {shown && <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />}
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>
  )
}

beforeEach(() => {
  store.clear()
  vi.mocked(api.list).mockResolvedValue(list())
  vi.mocked(api.restoreOrder).mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

async function open() {
  render(<Harness />)
  await screen.findByText('Loki')
  await act(async () => {})
}

const rowIds = () => Array.from(document.querySelectorAll('[data-row-id]')).map((row) => (row as HTMLElement).dataset['rowId'])
const row = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement
const shiftDown = (id: string, key: 'ArrowDown' | 'ArrowUp') => {
  act(() => row(id).focus())
  fireEvent.keyDown(row(id), { key, shiftKey: true })
}
const live = () => document.querySelector('.q-live')!.textContent
const toast = () => document.querySelector('.q-toast') as HTMLElement | null
const posted = () => vi.mocked(api.restoreOrder).mock.calls.map((call) => call[1])

describe('keyboard: Shift+↑↓', () => {
  it('moves a loose item as a block, past a whole group', async () => {
    await open()

    shiftDown('a', 'ArrowDown')

    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
    expect(api.restoreOrder).toHaveBeenCalledTimes(1)
  })

  it('scrolls the moved row into view, so a long list follows it instead of leaving it off screen', async () => {
    // jsdom has no scrollIntoView; the row that moved must be asked to come into view (nearest edge only).
    const scrolled = vi.fn(function (this: HTMLElement) {})
    Element.prototype.scrollIntoView = scrolled
    await open()

    shiftDown('a', 'ArrowDown')
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))

    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    expect(scrolled.mock.contexts.at(-1)).toBe(row('a'))
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('moves a group as a block', async () => {
    await open()

    shiftDown('gs', 'ArrowUp')

    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
  })

  it('moves an item inside its group only', async () => {
    await open()

    shiftDown('g1', 'ArrowDown')

    await waitFor(() => expect(rowIds()).toEqual(['a', 'gs', 'g2', 'g1', 'g3', 'b']))
  })

  it('says the new position: among the blocks, or among the group’s own items', async () => {
    await open()

    shiftDown('a', 'ArrowDown')
    await waitFor(() => expect(live()).toBe('A moved to 2 of 3'))

    shiftDown('g1', 'ArrowDown')
    await waitFor(() => expect(live()).toBe('G1 moved to 2 of 3 in Season 1'))
  })

  it('says it is at the edge, and saves nothing', async () => {
    await open()

    shiftDown('g1', 'ArrowUp')
    await waitFor(() => expect(live()).toBe('Already at the top of Season 1'))

    shiftDown('b', 'ArrowDown')
    await waitFor(() => expect(live()).toBe('Already at the bottom of the list'))
    expect(api.restoreOrder).not.toHaveBeenCalled()
  })

  it('keeps focus on the row that moved', async () => {
    await open()

    shiftDown('a', 'ArrowDown')

    await waitFor(() => expect(document.activeElement).toBe(row('a')))
  })

  it('plain ↑↓ still only walk the rows', async () => {
    await open()
    act(() => row('a').focus())

    fireEvent.keyDown(row('a'), { key: 'ArrowDown' })

    expect(document.activeElement).toBe(row('gs'))
    expect(api.restoreOrder).not.toHaveBeenCalled()
  })

  it('shows the moved row washed, so the eye can find where it went', async () => {
    await open()

    shiftDown('a', 'ArrowDown')

    await waitFor(() => expect(row('a').classList.contains('pulse')).toBe(true))
  })

  it('saves quick steps one after another, so they cannot land out of order, and one failure does not stop the next', async () => {
    let releaseFirst!: (value?: unknown) => void
    vi.mocked(api.restoreOrder)
      .mockReturnValueOnce(new Promise((resolve, reject) => (releaseFirst = () => reject(new Error('slow and failed')))))
      .mockResolvedValue(undefined)
    await open()

    shiftDown('a', 'ArrowDown')
    shiftDown('a', 'ArrowDown')
    await act(async () => {})
    expect(api.restoreOrder).toHaveBeenCalledTimes(1)

    await act(async () => releaseFirst())

    await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledTimes(2))
  })

  it('puts the row back, and says so, when the server refuses', async () => {
    vi.mocked(api.restoreOrder).mockRejectedValue(new Error('no'))
    await open()

    shiftDown('a', 'ArrowDown')

    expect(await screen.findByText('Couldn\'t save that move')).toBeTruthy()
    expect(rowIds()).toEqual(['a', 'gs', 'g1', 'g2', 'g3', 'b'])
  })

  describe('the toast for a run', () => {
    it('says nothing while stepping, then once after a pause, covering every step', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()

      shiftDown('a', 'ArrowDown')
      shiftDown('a', 'ArrowDown')
      await act(async () => {})
      expect(toast()).toBeNull()

      await act(async () => void vi.advanceTimersByTime(1300))
      expect(toast()!.textContent).toMatch(/^Item moved\.?Undo/)
    })

    it('waits for a pause, not for the first step’s clock: each step starts the wait again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()

      shiftDown('a', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(1000))
      shiftDown('a', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(1000))
      expect(toast()).toBeNull()

      await act(async () => void vi.advanceTimersByTime(300))
      expect(toast()!.textContent).toMatch(/^Item moved\.?Undo/)
    })

    it('says the standard "Item moved" for a single step, not a count of rows', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()

      shiftDown('a', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(1300))

      expect(toast()!.textContent).toMatch(/^Item moved\.?Undo/)
    })

    it('names the group when the run stayed inside one, like a drag does', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()

      shiftDown('g1', 'ArrowDown')
      shiftDown('g1', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(1300))

      expect(toast()!.textContent).toMatch(/^Item moved inside Season 1\.Undo/)
    })

    it('ends when focus leaves the list', async () => {
      await open()
      shiftDown('a', 'ArrowDown')

      act(() => screen.getByRole('button', { name: 'outside' }).focus())

      await waitFor(() => expect(toast()?.textContent).toMatch(/^Item moved\.?Undo/))
    })

    it('does not end when focus only moves to another row of the list', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()
      shiftDown('a', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(100))

      act(() => row('b').focus())
      await act(async () => void vi.advanceTimersByTime(300))

      expect(toast()).toBeNull()
    })

    it('Undo puts every row of the run back at its first position, in one call', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await open()
      shiftDown('a', 'ArrowDown')
      shiftDown('a', 'ArrowDown')
      await act(async () => void vi.advanceTimersByTime(1300))
      await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'b', 'a']))

      fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(rowIds()).toEqual(['a', 'gs', 'g1', 'g2', 'g3', 'b']))
      const undo = posted().at(-1)!
      expect(undo.items.find((entry) => entry.id === 'a')).toEqual({ id: 'a', orderIndex: 0 })
      expect(within(document.body).queryByText(/Moved \d+ rows?/)).toBeNull()
    })

    it('follows you out: leaving the screen mid-run still raises the toast, and Undo still works', async () => {
      await open()
      shiftDown('a', 'ArrowDown')

      act(() => removable())

      await waitFor(() => expect(toast()?.textContent).toMatch(/^Item moved\.?Undo/))
      fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledTimes(2))
      expect(posted().at(-1)!.items).toContainEqual({ id: 'a', orderIndex: 0 })
    })
  })
})

/** Rows 46px tall from y=100, in DOM order; what is under the pointer is the row whose band holds it. */
function layout() {
  const rows = Array.from(document.querySelectorAll('[data-drag-key]')) as HTMLElement[]
  rows.forEach((el, index) => {
    const top = 100 + index * 46
    el.getBoundingClientRect = () => ({ top, height: 46, bottom: top + 46, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) })
  })
  document.elementFromPoint = (_x: number, y: number) => rows.find((el) => y >= 100 + rows.indexOf(el) * 46 && y < 146 + rows.indexOf(el) * 46) ?? null
  return (id: string) => 100 + rows.indexOf(row(id)) * 46
}

const handleOf = (id: string) => row(id).querySelector('.q-handle') as HTMLElement
const pointer = (type: 'pointermove' | 'pointerup', y: number) =>
  act(() => void window.dispatchEvent(new MouseEvent(type, { clientX: 20, clientY: y, bubbles: true, cancelable: true })))

async function drag(id: string, toId: string, half: 'upper' | 'lower') {
  const top = layout()
  const startY = top(id) + 20
  fireEvent.pointerDown(handleOf(id), { button: 0, clientX: 10, clientY: startY })
  pointer('pointermove', startY + 12)
  const y = top(toId) + (half === 'upper' ? 8 : 38)
  pointer('pointermove', y)
  return { y, release: () => pointer('pointerup', y) }
}

describe('dragging by the handle', () => {
  it('drops a loose item after a group, and offers Undo', async () => {
    await open()

    const gesture = await drag('a', 'gs', 'lower')
    gesture.release()

    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
    expect(toast()!.textContent).toMatch(/Item moved/)
    expect(within(toast()!).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('shows the drop line where it would land, and dims the row it carries', async () => {
    await open()

    await drag('a', 'b', 'lower')

    expect(row('a').classList.contains('dragging')).toBe(true)
    expect(row('b').querySelector('.q-dropline.after')).not.toBeNull()
  })

  it('shuts every group while a block is dragged, so only boundaries are targets, and opens them again after', async () => {
    await open()
    expect(rowIds()).toContain('g1')

    const gesture = await drag('a', 'b', 'lower')
    expect(rowIds()).not.toContain('g1')

    gesture.release()
    await waitFor(() => expect(rowIds()).toContain('g1'))
  })

  it('does not shut a group for dragging an item inside it', async () => {
    await open()

    await drag('g1', 'g3', 'lower')

    expect(rowIds()).toContain('g2')
  })

  it('drops an item inside its own group, and says where', async () => {
    await open()

    const gesture = await drag('g1', 'g3', 'lower')
    gesture.release()

    await waitFor(() => expect(rowIds()).toEqual(['a', 'gs', 'g2', 'g3', 'g1', 'b']))
    expect(toast()!.textContent).toMatch(/Item moved inside Season 1\./)
  })

  it('drags a whole group past a loose item', async () => {
    await open()

    const gesture = await drag('gs', 'b', 'lower')
    gesture.release()

    await waitFor(() => expect(rowIds()).toEqual(['a', 'b', 'gs', 'g1', 'g2', 'g3']))
  })

  it('will not drop an item on another group’s rows or on a loose item', async () => {
    await open()

    const gesture = await drag('g1', 'b', 'lower')
    expect(document.querySelector('.q-dropline')).toBeNull()
    gesture.release()

    expect(api.restoreOrder).not.toHaveBeenCalled()
    expect(rowIds()).toEqual(['a', 'gs', 'g1', 'g2', 'g3', 'b'])
  })

  it('Undo puts the rows back with the positions the drop replaced', async () => {
    await open()
    const gesture = await drag('a', 'gs', 'lower')
    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))

    fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(rowIds()).toEqual(['a', 'gs', 'g1', 'g2', 'g3', 'b']))
    expect(posted()).toHaveLength(2)
  })

  it('washes the moved rows, a group’s items with it', async () => {
    await open()

    const gesture = await drag('gs', 'b', 'lower')
    gesture.release()

    await waitFor(() => expect(row('gs').classList.contains('pulse')).toBe(true))
    expect(row('g2').classList.contains('pulse')).toBe(true)
    expect(row('a').classList.contains('pulse')).toBe(false)
  })

  it('puts the rows back, and says so, when the server refuses the drop', async () => {
    vi.mocked(api.restoreOrder).mockRejectedValue(new Error('no'))
    await open()

    const gesture = await drag('a', 'gs', 'lower')
    gesture.release()

    expect(await screen.findByText('Couldn\'t save that move')).toBeTruthy()
    expect(rowIds()).toEqual(['a', 'gs', 'g1', 'g2', 'g3', 'b'])
    // A move that was not saved has nothing to undo.
    expect(toast()).toBeNull()
  })

  it('saves exactly what the keyboard would for the same move', async () => {
    await open()
    shiftDown('g1', 'ArrowDown')
    await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledTimes(1))
    const byKeyboard = posted()[0]

    cleanup()
    vi.mocked(api.restoreOrder).mockClear()
    await open()
    const gesture = await drag('g1', 'g2', 'lower')
    gesture.release()
    await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledTimes(1))

    expect(posted()[0]).toEqual(byKeyboard)
  })

  it('a click on the handle moves nothing and opens nothing', async () => {
    await open()

    fireEvent.pointerDown(handleOf('a'), { button: 0, clientX: 10, clientY: 120 })
    pointer('pointerup', 121)
    fireEvent.click(handleOf('a'))

    expect(api.restoreOrder).not.toHaveBeenCalled()
    expect(row('a').querySelector('[role="checkbox"]')!.getAttribute('aria-checked')).toBe('false')
  })
})
