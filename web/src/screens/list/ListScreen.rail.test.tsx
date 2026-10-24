// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'
import { RailPlacementProvider } from './RailPlacementContext.js'
import { railPlacement } from './railPlacement.js'

/** The jump rail on the list screen (task 10.24): groups only, more than one, remembered per list. */

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
  api: { list: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'tv', label: 'TV Shows', sortOrder: 1, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
]

const item = (id: string, orderIndex: number, group: string | null, done = false): ListItem => ({
  id,
  listId: 'L1',
  title: id.toUpperCase(),
  orderIndex,
  timeToConsumeMinutes: 30,
  timeToConsumeIsEstimated: false,
  consumedAt: done ? '2026-01-01T00:00:00Z' : null,
  source: 'import',
  year: null,
  group,
  tags: null,
  notes: null,
  yearUnk: 0,
  isNew: false,
})

/** Season 1 (a1 a2, both done), Season 2 (b1 b2 b3), and an empty group "Specials". */
function list(over: Partial<MediaListDetail> = {}): MediaListDetail {
  return {
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
    items: [
      item('a1', 0, 'Season 1', true),
      item('a2', 1, 'Season 1', true),
      item('b1', 2, 'Season 2'),
      item('b2', 3, 'Season 2'),
      item('b3', 4, 'Season 2'),
    ],
    groups: [
      { id: 'g1', listId: 'L1', name: 'Season 1', orderIndex: 0 } as ListGroup,
      { id: 'g2', listId: 'L1', name: 'Season 2', orderIndex: 1 } as ListGroup,
      { id: 'g3', listId: 'L1', name: 'Specials', orderIndex: 2 } as ListGroup,
    ],
    ...over,
  } as MediaListDetail
}

beforeEach(() => {
  store.clear()
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function open(detail: MediaListDetail = list(), where: { windowWidth: number; active?: boolean } | null = null) {
  vi.mocked(api.list).mockResolvedValue(detail)
  const screenOfList = (
    <ListScreen
      listId="L1"
      mediaTypes={TYPES}
      pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })}
      active={where?.active ?? true}
    />
  )
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          {where ? (
            <RailPlacementProvider value={{ placement: railPlacement(where.windowWidth, 'inside'), windowWidth: where.windowWidth }}>
              {screenOfList}
            </RailPlacementProvider>
          ) : (
            screenOfList
          )}
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText('Loki', { selector: 'h1' })
  await act(async () => {})
}

const rail = () => document.querySelector('.q-rail') as HTMLElement | null
const rowIds = () => Array.from(document.querySelectorAll('[data-row-id]')).map((row) => (row as HTMLElement).dataset['rowId'])

describe('the jump rail', () => {
  it('lists the groups that have items, with what is done in each, and leaves out empty ones', async () => {
    await open()

    const entries = within(rail()!).getAllByRole('button', { name: /Season/ })
    expect(entries.map((entry) => entry.textContent)).toEqual(['✓Season 12/2', 'Season 20/3'])
    expect(within(rail()!).queryByText('Specials')).toBeNull()
  })

  it('is not there with fewer than two groups that have items', async () => {
    const one = list()
    one.items = one.items.filter((entry) => entry.group === 'Season 1')
    await open(one)

    expect(rail()).toBeNull()
    expect(document.querySelector('.q-rail-stub')).toBeNull()
  })

  it('is not there for a list with no groups', async () => {
    await open(list({ groups: [], items: [item('x', 0, null), item('y', 1, null)] }))

    expect(rail()).toBeNull()
  })

  it('opens a collapsed group and scrolls it to the top of the list', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Season 2']))
    await open()
    expect(rowIds()).not.toContain('b1')
    const body = document.querySelector('.q-list-body') as HTMLElement

    fireEvent.click(within(rail()!).getByRole('button', { name: /Season 2/ }))

    await waitFor(() => expect(rowIds()).toContain('b1'))
    // Where the model puts the header of Season 2: Season 1's header (47px) and its two rows (46px each). Since 25.4 the jump scrolls to
    // the model's offset, not to a measured rectangle (a row that is not drawn has none).
    await waitFor(() => expect(body.scrollTop).toBe(47 + 2 * 46))
    expect(store.get('list:L1:collapsed')).toBe(JSON.stringify([]))
  })

  it('hides to a narrow stub, remembers that, and shows again', async () => {
    await open()

    fireEvent.click(within(rail()!).getByRole('button', { name: 'Collapse group jumper' }))

    expect(rail()).toBeNull()
    expect(document.querySelector('.q-rail-stub')).toBeTruthy()
    await waitFor(() => expect(store.get('list:L1:rail')).toBe('hidden'))

    cleanup()
    await open()
    expect(rail()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Enlarge group jumper' }))
    expect(rail()).toBeTruthy()
    await waitFor(() => expect(store.get('list:L1:rail')).toBe('shown'))
  })

  it('shows again on a click anywhere on the stub, not only its » button', async () => {
    store.set('list:L1:rail', 'hidden')
    await open()

    fireEvent.click(document.querySelector('.q-rail-stub .label')!)

    expect(rail()).toBeTruthy()
    await waitFor(() => expect(store.get('list:L1:rail')).toBe('shown'))
  })

  it('keeps its full counts while a filter narrows the list', async () => {
    await open()

    fireEvent.change(screen.getByPlaceholderText('Filter items…'), { target: { value: 'b1' } })

    expect(within(rail()!).getAllByRole('button', { name: /Season/ }).map((entry) => entry.textContent)).toEqual([
      '✓Season 12/2',
      'Season 20/3',
    ])
  })

  describe('width (F12)', () => {
    const grip = () => within(rail()!).getByRole('separator', { name: 'Resize group jumper' })
    const width = () => rail()!.style.width

    it('starts at the design’s 200px', async () => {
      await open()

      expect(width()).toBe('200px')
    })

    it('widens and narrows by dragging its edge, within 160–480px, and remembers it per list', async () => {
      await open()

      fireEvent.pointerDown(grip(), { button: 0, clientX: 200 })
      fireEvent.pointerMove(window, { clientX: 290 })
      expect(width()).toBe('290px')
      fireEvent.pointerMove(window, { clientX: 900 })
      expect(width()).toBe('480px')
      fireEvent.pointerMove(window, { clientX: 10 })
      expect(width()).toBe('160px')
      fireEvent.pointerMove(window, { clientX: 320 })
      fireEvent.pointerUp(window, { clientX: 320 })

      await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('320'))
      fireEvent.pointerMove(window, { clientX: 400 })
      expect(width()).toBe('320px')

      cleanup()
      await open()
      expect(width()).toBe('320px')
    })

    it('can be resized from the keyboard, and a double-click puts it back to 200px', async () => {
      await open()

      fireEvent.keyDown(grip(), { key: 'ArrowRight' })
      expect(width()).toBe('216px')
      expect(grip().getAttribute('aria-valuenow')).toBe('216')
      fireEvent.keyDown(grip(), { key: 'ArrowLeft' })
      fireEvent.keyDown(grip(), { key: 'ArrowLeft' })
      expect(width()).toBe('184px')
      await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('184'))

      fireEvent.doubleClick(grip())
      expect(width()).toBe('200px')
      await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('200'))
    })

    it('ignores a stored width that is out of range or not a number', async () => {
      store.set('list:L1:railWidth', '9000')
      await open()
      expect(width()).toBe('480px')

      cleanup()
      store.set('list:L1:railWidth', 'wide')
      await open()
      expect(width()).toBe('200px')
    })
  })
})

describe('the jump rail outside the card (H-019)', () => {
  const folded = () => document.querySelector('.q-rail.is-folded') as HTMLElement | null
  const grip = () => within(rail()!).getByRole('separator', { name: 'Resize group jumper' })

  it('stays inside in a window with no room beside the card', async () => {
    await open(list(), { windowWidth: 1512 })

    expect(rail()!.dataset['placement']).toBe('inside')
    expect(rail()!.style.width).toBe('200px')
  })

  it('leaves the card in a window that has the room, still a child of the list body box it sits in inside', async () => {
    await open(list(), { windowWidth: 1728 })

    expect(rail()!.dataset['placement']).toBe('outside')
    expect(rail()!.parentElement!.classList.contains('q-list-cols')).toBe(true)
  })

  it('keeps the reader’s width outside, capped at the margin minus 16px, and does not store the cap', async () => {
    store.set('list:L1:railWidth', '480')
    await open(list(), { windowWidth: 1552 })

    expect(rail()!.style.width).toBe('200px')
    expect(store.get('list:L1:railWidth')).toBe('480')

    cleanup()
    await open(list(), { windowWidth: 1920 })
    expect(rail()!.style.width).toBe('384px')

    cleanup()
    await open(list(), { windowWidth: 1440 })
    expect(rail()!.style.width).toBe('480px')
  })

  it('has its resize grip on the outer edge, with the cap as its largest value', async () => {
    await open(list(), { windowWidth: 1728 })

    expect(grip().classList.contains('q-rail-grip-out')).toBe(true)
    expect(grip().getAttribute('aria-valuenow')).toBe('200')
    expect(grip().getAttribute('aria-valuemin')).toBe('160')
    // Window 1728: margin 304, so 288 at most.
    expect(grip().getAttribute('aria-valuemax')).toBe('288')
  })

  it('widens when its outer edge is dragged left and narrows when it is dragged right, within 160px and the cap, and remembers it', async () => {
    await open(list(), { windowWidth: 1920 })

    fireEvent.pointerDown(grip(), { button: 0, clientX: 400 })
    fireEvent.pointerMove(window, { clientX: 350 })
    expect(rail()!.style.width).toBe('250px')
    fireEvent.pointerMove(window, { clientX: 0 })
    expect(rail()!.style.width).toBe('384px')
    fireEvent.pointerMove(window, { clientX: 900 })
    expect(rail()!.style.width).toBe('160px')
    fireEvent.pointerMove(window, { clientX: 320 })
    fireEvent.pointerUp(window)

    expect(rail()!.style.width).toBe('280px')
    await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('280'))
  })

  it('writes the width clamped to the cap, so what is shown is what is stored', async () => {
    store.set('list:L1:railWidth', '480')
    await open(list(), { windowWidth: 1552 })

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' })

    expect(rail()!.style.width).toBe('200px')
    await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('200'))
  })

  it('is resized from the keyboard mirrored to the inside grip (← widens, → narrows, 16px), and a double-click puts it back to 200px', async () => {
    await open(list(), { windowWidth: 1920 })

    fireEvent.keyDown(grip(), { key: 'ArrowLeft' })
    fireEvent.keyDown(grip(), { key: 'ArrowLeft' })
    expect(rail()!.style.width).toBe('232px')
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    expect(rail()!.style.width).toBe('216px')
    await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('216'))

    fireEvent.doubleClick(grip())
    expect(rail()!.style.width).toBe('200px')
    await waitFor(() => expect(store.get('list:L1:railWidth')).toBe('200'))
  })

  it('gets its own width back when the window is wider again: the cap is not stored', async () => {
    store.set('list:L1:railWidth', '350')
    await open(list(), { windowWidth: 1552 })
    expect(rail()!.style.width).toBe('200px')

    cleanup()
    await open(list(), { windowWidth: 1920 })
    expect(rail()!.style.width).toBe('350px')
  })

  it('folds to a 38px strip outside as the same element, and shows again on a press anywhere on it', async () => {
    store.set('list:L1:rail', 'hidden')
    await open(list(), { windowWidth: 1728 })
    const strip = folded()!

    expect(strip.dataset['placement']).toBe('outside')
    expect(strip.style.width).toBe('38px')
    expect(document.querySelector('.q-rail-stub')).toBeNull()
    fireEvent.click(strip.querySelector('.label')!)
    expect(folded()).toBeNull()
    // The element lives on, so its width can animate between the two.
    expect(rail()).toBe(strip)
    expect(strip.style.width).toBe('200px')
    await waitFor(() => expect(store.get('list:L1:rail')).toBe('shown'))
  })

  it('folds from the rail with its « button, to the same element', async () => {
    await open(list(), { windowWidth: 1728 })
    const element = rail()!

    fireEvent.click(within(element).getByRole('button', { name: 'Collapse group jumper' }))

    expect(rail()).toBe(element)
    expect(folded()).toBe(element)
    expect(element.style.width).toBe('38px')
    await waitFor(() => expect(store.get('list:L1:rail')).toBe('hidden'))
  })

  it('has no grip on the folded strip, and the » button is its keyboard stop', async () => {
    store.set('list:L1:rail', 'hidden')
    await open(list(), { windowWidth: 1728 })

    expect(within(rail()!).queryByRole('separator')).toBeNull()
    fireEvent.click(within(rail()!).getByRole('button', { name: 'Enlarge group jumper' }))
    expect(folded()).toBeNull()
  })

  it('shows only on the active layer: a covered list has no rail or strip outside', async () => {
    await open(list(), { windowWidth: 1728, active: false })
    expect(rail()).toBeNull()

    cleanup()
    store.set('list:L1:rail', 'hidden')
    await open(list(), { windowWidth: 1728, active: false })
    expect(rail()).toBeNull()
  })

  it('keeps a covered list’s rail inside, where the veil covers it', async () => {
    await open(list(), { windowWidth: 1440, active: false })

    expect(rail()!.dataset['placement']).toBe('inside')
  })

  it('is not there for a flat list, in a wide window either', async () => {
    await open(list({ groups: [], items: [item('x', 0, null), item('y', 1, null)] }), { windowWidth: 1728 })

    expect(rail()).toBeNull()
  })
})
