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
  yearUnk: 0,
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
/** The toast, once it is on screen: a drop shows it after its save has come back, not when the rows move. */
const shownToast = () =>
  waitFor(() => {
    const found = toast()
    expect(found).not.toBeNull()

    return found!
  })
const posted = () => vi.mocked(api.restoreOrder).mock.calls.map((call) => call[1])

/**
 * A save that takes a while. A drop moves the rows at once and shows its toast only when the save has come back, so on a slow machine the rows
 * are in place before the toast is (CI failed on this twice, BL-024): a test that reads the toast right after the rows moved must be able to
 * lose that race every time to prove it does not depend on winning it.
 */
const slowSave = (ms = 150) => vi.mocked(api.restoreOrder).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(undefined), ms)))

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

      expect(toast()!.textContent).toMatch(/^Item moved inside Season 1Undo/)
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

/** The block of each group as one box, from its rows: jsdom has no layout (call after `layout()`). */
function blockRects() {
  for (const block of document.querySelectorAll<HTMLElement>('[data-block-key]')) {
    const rows = [...block.querySelectorAll<HTMLElement>('[data-drag-key]')]
    const top = rows[0]!.getBoundingClientRect().top
    const bottom = rows[rows.length - 1]!.getBoundingClientRect().bottom
    block.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) })
  }
}

/** Picks up a block by its handle and moves to `y` (the rows are 46px from y=100: a, the group's header and rows, b). */
async function carry(id: string, y: number) {
  const top = layout()
  blockRects()
  const startY = top(id) + 20
  fireEvent.pointerDown(handleOf(id), { button: 0, clientX: 10, clientY: startY })
  pointer('pointermove', startY + 12)
  pointer('pointermove', y)
  return { release: () => pointer('pointerup', y) }
}

describe('a block carried over an open group targets the whole group (H-009)', () => {
  // a 100-146, the group header 146-192, g1 192-238, g2 238-284, g3 284-330, b 330-376: the group's span is 146-330, its middle 238.
  it('over a row in the lower half of the group: the line is at the group\'s bottom edge, and the block lands after the whole group', async () => {
    await open()

    const gesture = await carry('a', 270)

    const block = document.querySelector('[data-block-key="gs"]') as HTMLElement
    expect(block.querySelector(':scope > .q-dropline.after')).not.toBeNull()
    expect(row('gs').querySelector('.q-dropline')).toBeNull()
    expect(row('g2').querySelector('.q-dropline')).toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
  })

  it('over a row in the upper half of the group: the line is at the group\'s top edge, and the block lands before the group', async () => {
    await open()

    const gesture = await carry('b', 200)

    expect(row('gs').querySelector('.q-dropline:not(.after)')).not.toBeNull()
    expect(document.querySelector('[data-block-key="gs"] > .q-dropline')).toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b', 'gs', 'g1', 'g2', 'g3']))
  })

  it('a group is carried the same way: over an open group\'s rows it lands before or after the whole group', async () => {
    store.set('list:L1:collapsed', JSON.stringify([]))
    vi.mocked(api.list).mockResolvedValue({
      ...list(),
      items: [item('a', 0, 'Alpha'), item('g1', 1, 'Season 1'), item('g2', 2, 'Season 1'), item('g3', 3, 'Season 1')],
      groups: [
        { id: 'ga', listId: 'L1', name: 'Alpha', orderIndex: 0 } as ListGroup,
        { id: 'gs', listId: 'L1', name: 'Season 1', orderIndex: 1 } as ListGroup,
      ],
    })
    await open()

    // Alpha is carried (it folds to its header: 100-146); Season 1 is then 146-330, its middle 238; the pointer is over g3.
    const gesture = await carry('ga', 300)
    expect(document.querySelector('[data-block-key="gs"] > .q-dropline.after')).not.toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'ga', 'a']))
  })

  it('the target group takes the hover ground on its drawn rows and a tint of its own on its header, and loses them when the block is let go', async () => {
    await open()

    const gesture = await carry('a', 270)

    for (const id of ['g1', 'g2', 'g3']) expect(row(id).classList.contains('is-hover')).toBe(true)
    expect(row('gs').classList.contains('is-target')).toBe(true)
    expect(row('gs').classList.contains('is-hover')).toBe(false)
    for (const id of ['a', 'b']) expect(row(id).classList.contains('is-hover')).toBe(false)

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
    expect(document.querySelector('.is-hover, .is-target')).toBeNull()
  })

  it('a group carried over another open group tints that group, not itself; a loose item as a target tints nothing', async () => {
    store.set('list:L1:collapsed', JSON.stringify([]))
    vi.mocked(api.list).mockResolvedValue({
      ...list(),
      items: [item('a', 0, 'Alpha'), item('g1', 1, 'Season 1'), item('g2', 2, 'Season 1'), item('x', 3)],
      groups: [
        { id: 'ga', listId: 'L1', name: 'Alpha', orderIndex: 0 } as ListGroup,
        { id: 'gs', listId: 'L1', name: 'Season 1', orderIndex: 1 } as ListGroup,
      ],
    })
    await open()

    // Alpha (carried) over Season 1's rows: laid out before it folds, g1 is 238-284 and g2 284-330.
    const gesture = await carry('ga', 260)
    expect(row('gs').classList.contains('is-target')).toBe(true)
    expect(row('g1').classList.contains('is-hover')).toBe(true)
    expect(row('ga').classList.contains('is-target')).toBe(false)

    // Over the loose item x: a plain target, nothing tinted. (The rows were laid out before Alpha folded: x is 330-376.)
    pointer('pointermove', 345)
    expect(document.querySelector('.is-hover, .is-target')).toBeNull()
    expect(row('x').querySelector('.q-dropline')).not.toBeNull()
    gesture.release()
  })

  // H-016: one rule for every target, an open group's header and the rest: the line and the ground.
  it('a collapsed group\'s header takes the tint too, with the line, and loses both when the block is let go', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Season 1']))
    await open()

    const gesture = await carry('a', 160)

    expect(row('gs').classList.contains('is-target')).toBe(true)
    expect(row('gs').querySelector('.q-dropline')).not.toBeNull()
    expect(document.querySelector('.is-hover')).toBeNull()

    gesture.release()
    await waitFor(() => expect(document.querySelector('.is-target')).toBeNull())
  })

  it('an empty group\'s header takes the tint too, and loses it when the drag is cancelled with Esc', async () => {
    vi.mocked(api.list).mockResolvedValue({
      ...list(),
      groups: [
        { id: 'gs', listId: 'L1', name: 'Season 1', orderIndex: 0 } as ListGroup,
        { id: 'ge', listId: 'L1', name: 'Empty', orderIndex: 1 } as ListGroup,
      ],
    })
    await open()
    const top = layout()

    await carry('a', top('ge') + 8)

    expect(row('ge').classList.contains('is-target')).toBe(true)
    expect(row('gs').classList.contains('is-target')).toBe(false)

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    await waitFor(() => expect(document.querySelector('.is-target')).toBeNull())
  })

  it('a collapsed group keeps the plain rule: its header\'s upper half is before, its lower half after', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Season 1']))
    await open()

    // a 100-146, the shut header 146-192, b 192-238.
    const gesture = await carry('a', 185)
    expect(row('gs').querySelector('.q-dropline.after')).not.toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'a', 'b']))
  })

  it('an item inside a group still meets only its siblings: over another block it has no target', async () => {
    await open()

    await carry('g1', 125)

    expect(document.querySelector('.q-dropline')).toBeNull()
  })
})

describe('a drop line that is off screen is pinned to the list\'s edge (H-014)', () => {
  /** The list's scroll area as jsdom cannot have it: `viewport` px tall, scrolled to `scrollTop` (a scroll event tells the screen). */
  function view(viewport: number, scrollTop: number) {
    const body = document.querySelector('.q-list-body') as HTMLElement
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: viewport })
    body.scrollTop = scrollTop
    fireEvent.scroll(body)
  }
  const pin = () => document.querySelector('.q-droppin') as HTMLElement | null

  // a 0-46, Season 1 46-231 (the header 47, three rows of 46), b 231-277 in the model; the pointer rules use the fake layout (blockRects).
  it('over a group taller than the view whose top is above it, in the upper half: a line at the top edge saying "↑ Before Season 1", and no line on the header', async () => {
    await open()
    view(120, 60)

    const gesture = await carry('b', 200)

    expect(pin()?.textContent).toBe('↑ Before Season 1')
    expect(pin()?.classList.contains('top')).toBe(true)
    expect(pin()?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('.q-dropline')).toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['a', 'b', 'gs', 'g1', 'g2', 'g3']))
    expect(pin()).toBeNull()
  })

  it('over the lower half of a group whose bottom is below the view: a line at the bottom edge saying "↓ After Season 1"', async () => {
    await open()
    view(120, 0)

    const gesture = await carry('a', 270)

    expect(pin()?.textContent).toBe('↓ After Season 1')
    expect(pin()?.classList.contains('bottom')).toBe(true)
    expect(document.querySelector('.q-dropline')).toBeNull()

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
    expect(pin()).toBeNull()
  })

  it('a group that fits in the view never pins: its real line shows as before', async () => {
    await open()
    view(400, 60)

    await carry('b', 200)

    expect(pin()).toBeNull()
    expect(row('gs').querySelector('.q-dropline:not(.after)')).not.toBeNull()
  })

  it('a tall group whose real line is on screen does not pin (top at the view\'s top, scrolled by its own height)', async () => {
    await open()
    view(120, 40)
    // The top (46) is below the view's top (40): the line is where the header is.
    await carry('b', 200)

    expect(pin()).toBeNull()
    expect(row('gs').querySelector('.q-dropline:not(.after)')).not.toBeNull()
  })

  it('goes away when the pointer moves to another target, on Esc and on a drop', async () => {
    await open()
    view(120, 60)
    await carry('b', 200)
    expect(pin()).not.toBeNull()

    // Over the loose item a (the first row, 100-146): a plain target, nothing is pinned.
    pointer('pointermove', 110)
    expect(pin()).toBeNull()

    pointer('pointermove', 200)
    expect(pin()).not.toBeNull()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(pin()).toBeNull()
  })

  it('follows the scroll: it shows when the scroll takes the real line out of view and goes when it brings it back', async () => {
    await open()
    view(120, 0)
    await carry('b', 200)
    expect(pin()).toBeNull()

    view(120, 100)
    expect(pin()?.textContent).toBe('↑ Before Season 1')

    view(120, 0)
    expect(pin()).toBeNull()
  })

  it('a collapsed group never pins', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Season 1']))
    await open()
    view(20, 60)

    await carry('a', 160)

    expect(pin()).toBeNull()
  })
})

describe('no row is tinted by the pointer during or after an item drag (BL-105)', () => {
  const tinted = () => Array.from(document.querySelectorAll('[data-pointer]')).map((node) => (node as HTMLElement).dataset['rowId'])
  /** The pointer over a row as the browser sends it: the event goes to the row and bubbles up to the list and the window. */
  const over = (id: string, y: number) =>
    act(() => void row(id).dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: y, bubbles: true, cancelable: true })))

  it('the row under a resting mouse is tinted; one carried over many rows leaves none tinted, while carrying and after the drop', async () => {
    await open()
    const top = layout()
    over('a', top('a') + 10)
    expect(tinted()).toEqual(['a'])

    fireEvent.pointerDown(handleOf('a'), { button: 0, clientX: 10, clientY: top('a') + 20 })
    pointer('pointermove', top('a') + 32)
    for (const id of ['g1', 'g2', 'g3', 'b']) {
      over(id, top(id) + 38)
      expect(tinted()).toEqual([])
    }

    pointer('pointerup', top('b') + 38)
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'b', 'a']))
    expect(tinted()).toEqual([])

    // Only the next real move over a row tints it.
    over('g2', top('g2') + 10)
    expect(tinted()).toEqual(['g2'])
  })

  it('Esc during the drag leaves none tinted either', async () => {
    await open()
    const top = layout()
    over('b', top('b') + 10)
    fireEvent.pointerDown(handleOf('b'), { button: 0, clientX: 10, clientY: top('b') + 20 })
    pointer('pointermove', top('b') + 32)
    over('g1', top('g1') + 10)

    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))

    expect(tinted()).toEqual([])
  })
})

describe('dragging by the handle', () => {
  it('drops a loose item after a group, and offers Undo', async () => {
    await open()
    slowSave()

    const gesture = await drag('a', 'gs', 'lower')
    gesture.release()

    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))
    const shown = await shownToast()
    expect(shown.textContent).toMatch(/Item moved/)
    expect(within(shown).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('shows the drop line where it would land, and dims the row it carries', async () => {
    await open()

    await drag('a', 'b', 'lower')

    expect(row('a').classList.contains('dragging')).toBe(true)
    expect(row('b').querySelector('.q-dropline.after')).not.toBeNull()
  })

  it('folds only the group it carries while a group is dragged, and opens it again after (H-009)', async () => {
    await open()
    expect(rowIds()).toContain('g1')

    const gesture = await drag('gs', 'b', 'lower')
    expect(rowIds()).toContain('gs')
    expect(rowIds()).not.toContain('g1')

    gesture.release()
    await waitFor(() => expect(rowIds()).toContain('g1'))
  })

  it('folds nothing while a loose item is dragged: every group stays as it was (H-009)', async () => {
    await open()

    const gesture = await drag('a', 'b', 'lower')
    expect(rowIds()).toContain('g1')
    expect(rowIds()).toContain('g3')

    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'b', 'a']))
    expect(rowIds()).toContain('g1')
  })

  it('does not shut a group for dragging an item inside it', async () => {
    await open()

    await drag('g1', 'g3', 'lower')

    expect(rowIds()).toContain('g2')
  })

  it('drops an item inside its own group, and says where', async () => {
    await open()
    slowSave()

    const gesture = await drag('g1', 'g3', 'lower')
    gesture.release()

    await waitFor(() => expect(rowIds()).toEqual(['a', 'gs', 'g2', 'g3', 'g1', 'b']))
    expect((await shownToast()).textContent).toMatch(/Item moved inside Season 1/)
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
    slowSave()
    const gesture = await drag('a', 'gs', 'lower')
    gesture.release()
    await waitFor(() => expect(rowIds()).toEqual(['gs', 'g1', 'g2', 'g3', 'a', 'b']))

    fireEvent.click(within(await shownToast()).getByRole('button', { name: 'Undo' }))

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
