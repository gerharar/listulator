// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError, api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

const store = new Map<string, string>()

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: string) => void store.set(key, value),
  }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', async () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message)
    }
  }

  return {
    ApiError: MockApiError,
    api: {
      list: vi.fn(),
      setConsumed: vi.fn(),
      addItem: vi.fn(),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
      restoreItem: vi.fn(),
      checkForUpdates: vi.fn(),
      importItems: vi.fn(),
      markSeen: vi.fn(),
    },
  }
})

beforeEach(() => store.clear())
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function mediaType(key: string, label: string): MediaType {
  return {
    key,
    label,
    sortOrder: 1,
    defaultDurationMinutes: 30,
    searchAvailable: true,
    previewable: true,
  }
}

const TYPES = [mediaType('tv', 'TV Shows'), mediaType('mega', 'Mega'), mediaType('book', 'Books')]

let n = 0
function item(overrides: Partial<ListItem> = {}): ListItem {
  n += 1

  return {
    id: `i${n}`,
    listId: 'L1',
    title: `Item ${n}`,
    orderIndex: n,
    timeToConsumeMinutes: 60,
    timeToConsumeIsEstimated: false,
    consumedAt: null,
    source: 'import',
    year: null,
    group: null,
    tags: null,
    notes: null,
    isNew: false,
    ...overrides,
  }
}

function detail(overrides: Partial<MediaListDetail> = {}): MediaListDetail {
  return {
    id: 'L1',
    title: 'Loki',
    description: 'The trickster',
    mediaType: 'tv',
    source: 'api',
    externalRef: null,
    status: 'ongoing',
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: [],
    groups: [],
    ...overrides,
  } as MediaListDetail
}

function renderScreen(listId: string, updateAvailable = false) {
  return render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen listId={listId} mediaTypes={TYPES} updateAvailable={updateAvailable} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
}

async function open(list: MediaListDetail, updateAvailable = false) {
  vi.mocked(api.list).mockResolvedValue(list)
  renderScreen(list.id, updateAvailable)
  await screen.findByRole('heading', { name: /^Loki/ }).catch(() => undefined)
  await act(async () => {})
}

describe('ListScreen header', () => {
  it('shows the category, the name with its status, the description and the progress', async () => {
    await open(
      detail({
        items: [item({ consumedAt: '2026-01-01' }), item(), item()],
      }),
    )

    // The locale's label (C1), not the registry's "TV Shows".
    expect(screen.getByText('TV Series')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Loki/ })).toBeTruthy()
    expect(screen.getByText('Ongoing')).toBeTruthy()
    expect(screen.getByText('The trickster')).toBeTruthy()
    expect(screen.getByText('1/3 (33%)')).toBeTruthy()
    expect(screen.getByText('2h left')).toBeTruthy()
  })

  it('says "Done for now" when every item is done on an ongoing list', async () => {
    await open(detail({ items: [item({ consumedAt: '2026-01-01' })] }))

    expect(screen.getByText('✓ Done for now')).toBeTruthy()
  })

  it('explains the cell bar on hover: one cell per item, or a block of items past 20', async () => {
    await open(detail({ items: [item(), item()] }))

    expect(document.querySelector('.q-meter')!.getAttribute('title')).toMatch(/One cell = one item/)
  })

  it('shows the actions that come later as present but disabled, saying so', async () => {
    await open(detail({ items: [item()] }))

    for (const name of ['Edit list', 'Order', 'More']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toMatch(/coming soon/i)
    }
  })
})

describe('ListScreen loading', () => {
  it('shows a spinner, then the list', async () => {
    let resolve: (value: MediaListDetail) => void = () => {}
    vi.mocked(api.list).mockReturnValue(new Promise((r) => (resolve = r)))
    renderScreen("L1")

    expect(screen.getByText('Loading the list…')).toBeTruthy()
    await act(async () => resolve(detail({ items: [item({ title: 'Only' })] })))

    expect(await screen.findByText('Only')).toBeTruthy()
  })

  it('says so when the list cannot be loaded, and Retry loads it again', async () => {
    vi.mocked(api.list).mockRejectedValueOnce(new ApiError('Server is down', 0))
    vi.mocked(api.list).mockResolvedValueOnce(detail({ items: [item({ title: 'Back' })] }))
    renderScreen("L1")

    expect(await screen.findByText('Server is down')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Back')).toBeTruthy()
  })

  it('says so for a list with nothing in it', async () => {
    await open(detail({ items: [] }))

    expect(screen.getByText(/No items yet/)).toBeTruthy()
  })
})

describe('ListScreen spine', () => {
  const grouped = () =>
    detail({
      items: [
        item({ title: 'e1', group: 'Season 1' }),
        item({ title: 'e2', group: 'Season 1' }),
        item({ title: 'e3', group: 'Season 2' }),
      ],
      groups: [
        { id: 'g1', listId: 'L1', name: 'Season 1', orderIndex: 0 },
        { id: 'g2', listId: 'L1', name: 'Season 2', orderIndex: 1 },
      ],
    })

  it('shows groups open, with their items, on an ordinary list', async () => {
    await open(grouped())

    expect(screen.getByText('e1')).toBeTruthy()
    expect(screen.getByText('e3')).toBeTruthy()
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(2)
  })

  it('shows every group of a Mega list collapsed on arrival (C3)', async () => {
    await open(detail({ ...grouped(), mediaType: 'mega' }))

    expect(screen.queryByText('e1')).toBeNull()
    expect(screen.getByText('Season 1')).toBeTruthy()
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2)
  })

  it('remembers what you opened and closed, per list', async () => {
    await open(detail({ ...grouped(), mediaType: 'mega' }))

    fireEvent.click(screen.getByRole('button', { name: /Season 1/ }))
    expect(screen.getByText('e1')).toBeTruthy()
    await waitFor(() => expect(JSON.parse(store.get('list:L1:collapsed')!)).toEqual(['Season 2']))

    cleanup()
    await open(detail({ ...grouped(), mediaType: 'mega' }))
    expect(screen.getByText('e1')).toBeTruthy()
    expect(screen.queryByText('e3')).toBeNull()
  })

  it('shows an empty group, at the end, with nothing under it', async () => {
    await open(
      detail({
        items: [item({ title: 'a', group: 'A' })],
        groups: [
          { id: 'g0', listId: 'L1', name: 'Empty', orderIndex: 0 },
          { id: 'g1', listId: 'L1', name: 'A', orderIndex: 1 },
        ],
      }),
    )

    const heads = screen.getAllByRole('button', { expanded: true }).map((row) => row.textContent)
    expect(heads[0]).toContain('A')
    expect(heads[1]).toContain('Empty')
  })
})

describe('ListScreen done state', () => {
  it('updates the header sentence at once, before the server has answered', async () => {
    vi.mocked(api.setConsumed).mockReturnValue(new Promise(() => {}))
    await open(detail({ items: [item({ title: 'a' }), item({ title: 'b' })] }))
    expect(screen.getByText('0/2 (0%)')).toBeTruthy()

    fireEvent.click(screen.getByText('a'))

    expect(screen.getByText('1/2 (50%)')).toBeTruthy()
    expect(api.setConsumed).toHaveBeenCalledWith('L1', expect.any(String), true)
  })

  it('unticks an item that was done', async () => {
    vi.mocked(api.setConsumed).mockResolvedValue({} as never)
    await open(detail({ items: [item({ title: 'a', consumedAt: '2026-01-01' })] }))

    fireEvent.click(screen.getByText('a'))

    expect(screen.getByText('0/1 (0%)')).toBeTruthy()
    expect(api.setConsumed).toHaveBeenCalledWith('L1', expect.any(String), false)
  })

  it('rolls back and says so when the server refuses', async () => {
    vi.mocked(api.setConsumed).mockRejectedValue(new ApiError('nope', 500))
    await open(detail({ items: [item({ title: 'a' })] }))

    fireEvent.click(screen.getByText('a'))

    expect(await screen.findByText('Could not save that change')).toBeTruthy()
    expect(screen.getByText('0/1 (0%)')).toBeTruthy()
  })

  it('updates a group’s own progress too', async () => {
    vi.mocked(api.setConsumed).mockResolvedValue({} as never)
    await open(
      detail({
        items: [item({ title: 'e1', group: 'S1' })],
        groups: [{ id: 'g1', listId: 'L1', name: 'S1', orderIndex: 0 }],
      }),
    )

    fireEvent.click(screen.getByText('e1'))

    const group = screen.getByRole('button', { expanded: true })
    expect(within(group).getByText('✓ All done')).toBeTruthy()
  })
})

describe('ListScreen keyboard', () => {
  const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]'))

  it('is one tab stop: only one row can be tabbed to', async () => {
    await open(detail({ items: [item(), item(), item()] }))

    expect(rows().filter((row) => row.tabIndex === 0)).toHaveLength(1)
  })

  it('walks the visible rows with the arrow keys, skipping collapsed items', async () => {
    await open(
      detail({
        mediaType: 'mega',
        items: [item({ title: 'e1', group: 'S1' }), item({ title: 'loose' })],
        groups: [{ id: 'g1', listId: 'L1', name: 'S1', orderIndex: 0 }],
      }),
    )
    const [first, second] = rows()
    first!.focus()

    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    // Collapsed S1: its item is not a row to walk to.
    expect(rows()).toHaveLength(2)
  })

  it('does not run off either end', async () => {
    await open(detail({ items: [item(), item()] }))
    const [first, second] = rows()
    first!.focus()

    fireEvent.keyDown(first!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    second!.focus()
    fireEvent.keyDown(second!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
  })

  it('remembers the last-focused row and starts there next time', async () => {
    const list = detail({ items: [item({ id: 'x1' }), item({ id: 'x2' }), item({ id: 'x3' })] })
    await open(list)
    rows()[1]!.focus()
    await waitFor(() => expect(store.get('list:L1:focus')).toBe('x2'))

    cleanup()
    await open(list)

    expect(rows().find((row) => row.tabIndex === 0)!.dataset['rowId']).toBe('x2')
  })
})

describe('ListScreen item actions (task 10.21)', () => {
  const groups = [
    { id: 'g1', listId: 'L1', name: 'Season 1', orderIndex: 0 },
    { id: 'g2', listId: 'L1', name: 'Season 2', orderIndex: 1 },
  ]
  const base = () =>
    detail({
      items: [
        item({ id: 'a', title: 'Alpha', group: 'Season 1', orderIndex: 0, notes: 'Curator note' }),
        item({ id: 'b', title: 'Beta', group: 'Season 1', orderIndex: 1 }),
        item({ id: 'c', title: 'Gamma', group: 'Season 2', orderIndex: 2 }),
      ],
      groups,
    })

  describe('adding', () => {
    it('adds to the end of a group, then shows the item, pulsing, from the server’s own order', async () => {
      const after = detail({
        ...base(),
        items: [
          ...base().items.slice(0, 2),
          item({ id: 'n', title: 'Newcomer', group: 'Season 1', orderIndex: 2 }),
          { ...base().items[2]!, orderIndex: 3 },
        ],
      })
      vi.mocked(api.addItem).mockResolvedValue(after.items[2]!)
      await open(base())
      vi.mocked(api.list).mockResolvedValue(after)

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Newcomer' } })
      fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Season 1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      expect(await screen.findByText('Newcomer')).toBeTruthy()
      expect(api.addItem).toHaveBeenCalledWith('L1', {
        title: 'Newcomer',
        timeToConsumeMinutes: 30,
        timeToConsumeIsEstimated: true,
        group: 'Season 1',
      })
      expect(document.querySelector('[data-row-id="n"]')!.className).toContain('pulse')
      await waitFor(() =>
        expect(document.querySelector('.q-live')!.textContent).toBe('Added Newcomer to Season 1'),
      )
    })

    it('sends the minutes you typed as real, not estimated', async () => {
      vi.mocked(api.addItem).mockResolvedValue(item())
      await open(base())
      vi.mocked(api.list).mockResolvedValue(base())

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'X' } })
      fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '12' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      await waitFor(() =>
        expect(api.addItem).toHaveBeenCalledWith('L1', {
          title: 'X',
          timeToConsumeMinutes: 12,
          timeToConsumeIsEstimated: false,
          group: null,
        }),
      )
    })

    it('offers the list’s groups in the group field, in order', async () => {
      await open(base())

      fireEvent.focus(screen.getByLabelText('Group'))

      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['No group', 'Season 1', 'Season 2'])
    })

    it('opens a collapsed group the new item went into, so it can be seen', async () => {
      const mega = { ...base(), mediaType: 'mega' }
      const after = { ...mega, items: [...mega.items, item({ id: 'n', title: 'Newcomer', group: 'Season 1', orderIndex: 3 })] }
      vi.mocked(api.addItem).mockResolvedValue(after.items[3]!)
      await open(mega)
      expect(screen.queryByText('Alpha')).toBeNull()
      vi.mocked(api.list).mockResolvedValue(after)

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Newcomer' } })
      fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Season 1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))

      expect(await screen.findByText('Newcomer')).toBeTruthy()
    })
  })

  describe('removing', () => {
    it('removes at once, then offers Undo, which brings the row back with a pulse', async () => {
      const restore = { item: { id: 'b' }, dismissalId: 'd' }
      vi.mocked(api.deleteItem).mockResolvedValue(restore as never)
      vi.mocked(api.restoreItem).mockResolvedValue(base().items[1]!)
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }))

      expect(screen.queryByText('Beta')).toBeNull()
      expect(api.deleteItem).toHaveBeenCalledWith('L1', 'b')
      // The toast, and the live region that says it aloud.
      expect((await screen.findAllByText('Removed Beta')).length).toBeGreaterThan(0)
      expect(document.querySelector('.q-toast')!.textContent).toContain('Removed Beta')

      vi.mocked(api.list).mockResolvedValue(base())
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Beta')).toBeTruthy()
      expect(api.restoreItem).toHaveBeenCalledWith('L1', restore)
      expect(document.querySelector('[data-row-id="b"]')!.className).toContain('pulse')
      // Said aloud too, for anyone not watching the pulse.
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Restored Beta'))
    })

    it('updates the header as the item goes', async () => {
      vi.mocked(api.deleteItem).mockReturnValue(new Promise(() => {}))
      await open(base())
      expect(screen.getByText('0/3 (0%)')).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }))

      expect(screen.getByText('0/2 (0%)')).toBeTruthy()
    })

    it('puts the row back and says so when the server refuses', async () => {
      vi.mocked(api.deleteItem).mockRejectedValue(new ApiError('nope', 500))
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }))

      expect(await screen.findByText('Could not remove Beta')).toBeTruthy()
      expect(screen.getByText('Beta')).toBeTruthy()
    })

    it('does not toggle the row it was pressed in', async () => {
      vi.mocked(api.deleteItem).mockResolvedValue({} as never)
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }))

      expect(api.setConsumed).not.toHaveBeenCalled()
    })
  })

  describe('details and editing', () => {
    it('opens the item’s details, with its notes', async () => {
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Details for Alpha' }))

      expect(await screen.findByText('Curator note')).toBeTruthy()
    })

    it('Save applies just the change, and reloads the list', async () => {
      vi.mocked(api.updateItem).mockResolvedValue(base().items[0]!)
      await open(base())
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await screen.findByRole('dialog')
      vi.mocked(api.list).mockResolvedValue(
        detail({ ...base(), items: [{ ...base().items[0]!, title: 'Renamed' }, ...base().items.slice(1)] }),
      )

      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Renamed')).toBeTruthy()
      expect(api.updateItem).toHaveBeenCalledWith('L1', 'a', { title: 'Renamed' })
      // An explicit save needs no "saved" toast.
      expect(screen.queryByText('Saved changes to Renamed')).toBeNull()
    })

    it('clicking away applies the change and offers Undo, which reverts it', async () => {
      vi.mocked(api.updateItem).mockResolvedValue(base().items[0]!)
      await open(base())
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await screen.findByRole('dialog')
      vi.mocked(api.list).mockResolvedValue(base())

      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(document.querySelector('.q-catcher')!)

      expect((await screen.findAllByText('Saved changes to Renamed')).length).toBeGreaterThan(0)
      expect(api.updateItem).toHaveBeenCalledWith('L1', 'a', { title: 'Renamed' })

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(api.updateItem).toHaveBeenLastCalledWith('L1', 'a', { title: 'Alpha' }))
    })

    it('Discard changes nothing', async () => {
      await open(base())
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await screen.findByRole('dialog')

      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }))

      expect(api.updateItem).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('says so when a save fails, and leaves the list as it was', async () => {
      vi.mocked(api.updateItem).mockRejectedValue(new ApiError('nope', 500))
      await open(base())
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await screen.findByRole('dialog')

      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Could not save those changes')).toBeTruthy()
      expect(screen.getByText('Alpha')).toBeTruthy()
    })
  })
})

describe('ListScreen updates (task 10.25)', () => {
  const sourced = (extra: Partial<MediaListDetail> = {}) =>
    detail({
      externalRef: 'tmdb:1',
      items: [item({ id: 'a', title: 'Alpha' }), item({ id: 'b', title: 'Beta' })],
      ...extra,
    })
  const result = (titles: string[], extra: object = {}) => ({
    newItems: titles.map((title) => ({ title, externalRef: `ref:${title}` })),
    upstreamCount: 10,
    existingCount: 8,
    dismissedCount: 0,
    ...extra,
  })

  describe('the NEW marks and Mark all seen', () => {
    const withNew = () =>
      sourced({
        items: [
          item({ id: 'a', title: 'Alpha' }),
          item({ id: 'b', title: 'Beta', isNew: true }),
          item({ id: 'c', title: 'Gamma', isNew: true }),
        ],
      })

    it('shows no banner and no marks when nothing is new', async () => {
      await open(sourced())

      expect(screen.queryByText(/new items? w/)).toBeNull()
      expect(screen.queryByText('NEW')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Mark all seen' })).toBeNull()
    })

    it('marks the new rows, and says how many are new under the header', async () => {
      await open(withNew())

      expect(screen.getAllByText('NEW')).toHaveLength(2)
      expect(screen.getByText(/2 new items were added/)).toBeTruthy()
    })

    it('says "1 new item was added" for a single one', async () => {
      await open(sourced({ items: [item({ id: 'a', title: 'Alpha', isNew: true })] }))

      expect(screen.getByText(/1 new item was added/)).toBeTruthy()
    })

    it('clears the marks and the banner, and says so, when marked seen', async () => {
      vi.mocked(api.markSeen).mockResolvedValue({ cleared: 2 })
      await open(withNew())

      fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }))

      await waitFor(() => expect(screen.queryByText('NEW')).toBeNull())
      expect(api.markSeen).toHaveBeenCalledWith('L1')
      expect(screen.queryByRole('button', { name: 'Mark all seen' })).toBeNull()
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('All marked as seen'))
    })

    it('keeps the marks and says why when the server refuses', async () => {
      vi.mocked(api.markSeen).mockRejectedValue(new Error('down'))
      await open(withNew())

      fireEvent.click(screen.getByRole('button', { name: 'Mark all seen' }))

      expect(await screen.findByText('Could not mark them as seen')).toBeTruthy()
      expect(screen.getAllByText('NEW')).toHaveLength(2)
    })
  })

  describe('Check for updates', () => {
    it('is offered only on a list that has a source to check', async () => {
      await open(detail({ externalRef: null, items: [item()] }))

      expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    })

    it('checks only when pressed, then names what the source gained', async () => {
      vi.mocked(api.checkForUpdates).mockResolvedValue(result(['Delta', 'Echo']))
      await open(sourced())
      expect(api.checkForUpdates).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByText(/Delta · Echo/)).toBeTruthy()
      expect(api.checkForUpdates).toHaveBeenCalledWith('L1', false)
      expect(api.importItems).not.toHaveBeenCalled()
    })

    it('says it is checking while it waits', async () => {
      let finish!: (value: ReturnType<typeof result>) => void
      vi.mocked(api.checkForUpdates).mockReturnValue(new Promise((resolve) => (finish = resolve)))
      await open(sourced())

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      const busy = await screen.findByRole('button', { name: 'Checking…' })
      expect((busy as HTMLButtonElement).disabled).toBe(true)
      await act(async () => finish(result([])))
      expect(await screen.findByText(/Up to date/)).toBeTruthy()
    })

    it('adds what was found as arrivals, then shows them as NEW', async () => {
      vi.mocked(api.checkForUpdates).mockResolvedValue(result(['Delta', 'Echo']))
      vi.mocked(api.importItems).mockResolvedValue([])
      await open(sourced())
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
      await screen.findByText(/Delta · Echo/)
      vi.mocked(api.list).mockResolvedValue(
        sourced({
          items: [
            item({ id: 'a', title: 'Alpha' }),
            item({ id: 'd', title: 'Delta', isNew: true }),
            item({ id: 'e', title: 'Echo', isNew: true }),
          ],
        }),
      )

      fireEvent.click(screen.getByRole('button', { name: 'Add 2 to this list' }))

      await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(2))
      expect(api.importItems).toHaveBeenCalledWith(
        'L1',
        [
          { title: 'Delta', externalRef: 'ref:Delta' },
          { title: 'Echo', externalRef: 'ref:Echo' },
        ],
        'import',
        true,
      )
      expect(screen.queryByText(/Delta · Echo/)).toBeNull()
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Added 2 items'))
      expect(screen.getByText(/2 new items were added/)).toBeTruthy()
    })

    it('runs the check again, including deleted entries, when the box is ticked', async () => {
      vi.mocked(api.checkForUpdates).mockResolvedValue(result([]))
      await open(sourced())
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
      await screen.findByText(/Up to date/)

      fireEvent.click(screen.getByRole('checkbox', { name: 'Re-add deleted entries' }))

      await waitFor(() => expect(api.checkForUpdates).toHaveBeenLastCalledWith('L1', true))
    })

    it('shows an error, not a card, when the check fails', async () => {
      vi.mocked(api.checkForUpdates).mockRejectedValue(new Error('Source is down'))
      await open(sourced())

      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))

      expect(await screen.findByText('Source is down')).toBeTruthy()
      expect(screen.queryByText(/Up to date/)).toBeNull()
    })

    it('keeps the card and says so when adding fails', async () => {
      vi.mocked(api.checkForUpdates).mockResolvedValue(result(['Delta']))
      vi.mocked(api.importItems).mockRejectedValue(new Error('nope'))
      await open(sourced())
      fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
      await screen.findByText(/Delta/)

      fireEvent.click(screen.getByRole('button', { name: 'Add 1 to this list' }))

      expect(await screen.findByText('Could not add them')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Add 1 to this list' })).toBeTruthy()
    })
  })

  describe('arriving from the Home banner', () => {
    it('calls the button "Update list", without checking by itself', async () => {
      await open(sourced(), true)

      expect(screen.getByRole('button', { name: 'Update list' })).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
      expect(api.checkForUpdates).not.toHaveBeenCalled()
    })
  })
})
