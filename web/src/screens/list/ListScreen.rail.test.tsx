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
  const stub = () => document.querySelector('.q-rail-stub') as HTMLElement | null

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

  it('has no resize grip outside (it comes with the outer-edge grip, 32.2)', async () => {
    await open(list(), { windowWidth: 1728 })

    expect(within(rail()!).queryByRole('separator')).toBeNull()
  })

  it('folds to the stub outside as well, and shows again', async () => {
    store.set('list:L1:rail', 'hidden')
    await open(list(), { windowWidth: 1728 })

    expect(rail()).toBeNull()
    expect(stub()!.dataset['placement']).toBe('outside')
    fireEvent.click(stub()!)
    expect(rail()!.dataset['placement']).toBe('outside')
  })

  it('shows only on the active layer: a covered list has no rail or stub outside', async () => {
    await open(list(), { windowWidth: 1728, active: false })
    expect(rail()).toBeNull()

    cleanup()
    store.set('list:L1:rail', 'hidden')
    await open(list(), { windowWidth: 1728, active: false })
    expect(stub()).toBeNull()
  })

  it('keeps a covered list’s rail inside, where the veil covers it', async () => {
    await open(list(), { windowWidth: 1440, active: false })

    expect(rail()!.dataset['placement']).toBe('inside')
  })

  it('is not there for a flat list, in a wide window either', async () => {
    await open(list({ groups: [], items: [item('x', 0, null), item('y', 1, null)] }), { windowWidth: 1728 })

    expect(rail()).toBeNull()
    expect(stub()).toBeNull()
  })
})
