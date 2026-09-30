// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError, api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { subscribeListsChanged } from '../../lib/listsChanged.js'
import { createPendingUpdates, type PendingUpdates } from '../../lib/pendingUpdates.js'
import { ListScreen } from './ListScreen.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'

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
      updateList: vi.fn(),
      deleteList: vi.fn(),
      restoreList: vi.fn(),
      sortList: vi.fn(),
      resetOrder: vi.fn(),
      restoreOrder: vi.fn(),
      resetPreview: vi.fn(),
      resetList: vi.fn(),
      restoreItems: vi.fn(),
      deleteGroup: vi.fn(),
      restoreGroup: vi.fn(),
      createGroup: vi.fn(),
      renameGroup: vi.fn(),
    },
  }
})

let pending: PendingUpdates

beforeEach(async () => {
  store.clear()
  pending = createPendingUpdates({
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
  })
  await pending.load()
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function mediaType(key: string, label: string, sourceName?: string): MediaType {
  return {
    key,
    label,
    sortOrder: 1,
    defaultDurationMinutes: 30,
    searchAvailable: true,
    previewable: true,
    ...(sourceName ? { sourceName } : {}),
  }
}

const TYPES = [
  mediaType('tv', 'TV Shows', 'TMDB'),
  mediaType('mega', 'Mega'),
  mediaType('book', 'Books', 'Open Library'),
  mediaType('youtube', 'YouTube', 'YouTube'),
]

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

const onLeave = vi.fn()
const onClose = vi.fn()

function renderScreen(listId: string) {
  return render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen listId={listId} mediaTypes={TYPES} pendingUpdates={pending} onLeave={onLeave} onClose={onClose} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
}

/** Opens the ⋯ menu and picks an item from it (the list's rarer actions all live there). */
async function pickFromMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More' }))
  await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
  fireEvent.click(within(document.querySelector('.q-pop') as HTMLElement).getByRole('button', { name }))
}

async function open(list: MediaListDetail) {
  vi.mocked(api.list).mockResolvedValue(list)
  renderScreen(list.id)
  await screen.findByRole('heading', { name: /^Loki/ }).catch(() => undefined)
  await act(async () => {})
}

describe('where the list came from (link-back under the add band)', () => {
  const LINE = /The original list arrived from/

  it('names and links the source a fetched list arrived from, and says it may have changed since', async () => {
    await open(detail({ source: 'api', externalRef: 'show:1399', items: [item()] }))

    const note = screen.getByText(LINE).closest('p')!
    expect(note.textContent).toBe('The original list arrived from TMDB ↗; you may have changed it since.')
    expect(within(note).getByRole('link', { name: /TMDB/ }).getAttribute('href')).toBe('https://www.themoviedb.org/')
    expect(note.compareDocumentPosition(screen.getByRole('button', { name: 'Add' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('links each source the owner named: Open Library too', async () => {
    await open(detail({ source: 'api', externalRef: 'author:OL1A', mediaType: 'book', items: [item()] }))

    expect(within(screen.getByText(LINE).closest('p')!).getByRole('link', { name: /Open Library/ }).getAttribute('href')).toBe(
      'https://openlibrary.org/',
    )
  })

  it('says nothing for a list that did not arrive from a source', async () => {
    for (const source of ['manual', 'file', 'canonical'] as const) {
      await open(detail({ source, externalRef: source === 'canonical' ? 'canonical:lists/tv/x.yaml' : null, items: [item()] }))
      expect(screen.queryByText(LINE)).toBeNull()
      cleanup()
    }
  })

  it('says nothing for YouTube, which is not on the owner’s list, or a category with no source', async () => {
    await open(detail({ source: 'api', externalRef: 'playlist:PL1', mediaType: 'youtube', items: [item()] }))
    expect(screen.queryByText(LINE)).toBeNull()
    cleanup()

    await open(detail({ source: 'api', externalRef: 'franchise:1', mediaType: 'mega', items: [item()] }))
    expect(screen.queryByText(LINE)).toBeNull()
  })
})

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

  it('has a ✕ at the right end of the header actions that closes the layer (prototype)', async () => {
    await open(detail({ items: [item()] }))

    const actions = document.querySelector('.q-list-actions') as HTMLElement
    const names = within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(names.at(-1)).toBe('Close')

    fireEvent.click(within(actions).getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onLeave).not.toHaveBeenCalled()
  })

  it('has no pencil beside the name: editing the list lives in the ⋯ menu (prototype)', async () => {
    await open(detail({ items: [item()] }))

    expect(screen.queryByRole('button', { name: 'Edit List' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Order' })).toBeNull()
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy()
  })

  it('says "Done for now" when every item is done on an ongoing list', async () => {
    await open(detail({ items: [item({ consumedAt: '2026-01-01' })] }))

    expect(screen.getByText('✓ Done (for now)')).toBeTruthy()
  })

  it('explains the cell bar on hover: one cell per item, or a block of items past 20', async () => {
    await open(detail({ items: [item(), item()] }))

    expect(await hoverTooltip(document.querySelector('.q-meter')!)).toMatch(/One cell = one item/)
  })
})

describe('ListScreen marks (task 11.9)', () => {
  const title = () => document.querySelector('.q-list-title') as HTMLElement

  it('puts the curated star to the left of the title of a community-library list', async () => {
    await open(detail({ source: 'canonical', items: [item()] }))

    expect(title().querySelector('.q-star')).not.toBeNull()
    expect(title().firstChild).toBe(title().querySelector('.q-star')) // on the left of the name, like the Home rows
    expect(title().querySelector('.q-byhand')).toBeNull()
  })

  it('puts the hand to the left of the title of a list made by hand', async () => {
    await open(detail({ source: 'manual', items: [item({ source: 'manual' })] }))

    expect(title().querySelector('.q-byhand')).not.toBeNull()
    expect(title().firstChild).toBe(title().querySelector('.q-byhand'))
    expect(title().querySelector('.q-star')).toBeNull()
  })

  it('puts no mark beside the title of a list synced from an API', async () => {
    await open(detail({ source: 'api', items: [item()] }))

    expect(title().querySelector('.q-star, .q-byhand')).toBeNull()
  })

  it('an all-manual list shows no hand on its rows: the header already says so', async () => {
    await open(detail({ source: 'manual', items: [item({ source: 'manual' }), item({ source: 'manual' })] }))

    expect(document.querySelectorAll('.q-item .q-manual')).toHaveLength(0)
  })

  it('a list mixing hand-added and imported items marks only the hand-added ones', async () => {
    await open(detail({ source: 'api', items: [item({ source: 'manual' }), item({ source: 'import' })] }))

    expect(document.querySelectorAll('.q-item .q-manual')).toHaveLength(1)
  })

  it('decides from every item, not the filtered ones', async () => {
    await open(
      detail({
        source: 'api',
        items: [item({ title: 'Zed', source: 'manual' }), item({ title: 'Ahab', source: 'import' })],
      }),
    )
    fireEvent.change(screen.getByPlaceholderText('Filter items…'), { target: { value: 'Zed' } })

    expect(document.querySelectorAll('.q-item')).toHaveLength(1)
    expect(document.querySelectorAll('.q-item .q-manual')).toHaveLength(1)
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

    expect(screen.getByText(/No items\.\.\. yet/)).toBeTruthy()
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

  // The jump rail repeats the group names, so the spine's own rows are looked up inside the spine.
  const spineBody = () => document.querySelector('.q-list-body') as HTMLElement

  it('shows every group of a Mega list collapsed on arrival (C3)', async () => {
    await open(detail({ ...grouped(), mediaType: 'mega' }))

    expect(screen.queryByText('e1')).toBeNull()
    expect(within(spineBody()).getByText('Season 1')).toBeTruthy()
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2)
  })

  it('remembers what you opened and closed, per list', async () => {
    await open(detail({ ...grouped(), mediaType: 'mega' }))

    fireEvent.click(within(spineBody()).getByRole('button', { name: /^Season 1/ }))
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

    expect(await screen.findByText('Couldn\'t save this change')).toBeTruthy()
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
    expect(within(group).getByText('✓ All Done')).toBeTruthy()
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

  describe('creating an empty group (11.17)', () => {
    it('makes the group from the add band with no title, shows it at the end and says so', async () => {
      await open(base())
      const created = { id: 'g3', listId: 'L1', name: 'Extras', orderIndex: 2 }
      vi.mocked(api.createGroup).mockResolvedValue(created)
      vi.mocked(api.list).mockResolvedValue({ ...base(), groups: [...groups, created] })

      fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Extras' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

      await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith('L1', 'Extras'))
      expect(api.addItem).not.toHaveBeenCalled()
      await waitFor(() => expect(document.querySelector('[data-row-id="g3"]')).not.toBeNull())
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Created group Extras'))
    })

    it('shows the API’s own refusal for a name the list already has', async () => {
      await open(base())
      vi.mocked(api.createGroup).mockRejectedValue(new Error('This list already has a group with such name.'))

      fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'Season 1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add Group' }))

      expect(await screen.findByText('This list already has a group with such name.')).toBeTruthy()
    })
  })

  describe('renaming a group (11.18)', () => {
    const renamed = { id: 'g1', listId: 'L1', name: 'Series One', orderIndex: 0 }
    const afterRename = () =>
      detail({
        items: [
          item({ id: 'a', title: 'Alpha', group: 'Series One', orderIndex: 0 }),
          item({ id: 'b', title: 'Beta', group: 'Series One', orderIndex: 1 }),
          item({ id: 'c', title: 'Gamma', group: 'Season 2', orderIndex: 2 }),
        ],
        groups: [renamed, groups[1]!],
      })
    const rename = (to: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Rename group Season 1' }))
      fireEvent.change(screen.getByLabelText('Group name'), { target: { value: to } })
      fireEvent.keyDown(screen.getByLabelText('Group name'), { key: 'Enter' })
    }

    it('renames through the API, shows the new name on the group and its items, and says so with an Undo', async () => {
      vi.mocked(api.renameGroup).mockResolvedValue(renamed)
      await open(base())
      vi.mocked(api.list).mockResolvedValue(afterRename())

      rename('Series One')

      await waitFor(() => expect(api.renameGroup).toHaveBeenCalledWith('L1', 'g1', 'Series One'))
      await waitFor(() => expect(screen.queryByLabelText('Group name')).toBeNull())
      expect(document.querySelector('[data-row-id="g1"] b')!.textContent).toBe('Series One')
      expect((await screen.findAllByText('Renamed group Season 1 to Series One')).length).toBeGreaterThan(0)
    })

    it('Undo names it back', async () => {
      vi.mocked(api.renameGroup).mockResolvedValue(renamed)
      await open(base())
      vi.mocked(api.list).mockResolvedValue(afterRename())
      rename('Series One')
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(api.renameGroup).toHaveBeenLastCalledWith('L1', 'g1', 'Season 1'))
    })

    it('keeps a folded group folded through its rename', async () => {
      vi.mocked(api.renameGroup).mockResolvedValue(renamed)
      await open(base())
      fireEvent.click(document.querySelector('[data-row-id="g1"]')!)
      expect(screen.queryByText('Alpha')).toBeNull()
      vi.mocked(api.list).mockResolvedValue(afterRename())

      rename('Series One')

      await waitFor(() => expect(api.renameGroup).toHaveBeenCalled())
      await waitFor(() => expect(document.querySelector('[data-row-id="g1"] b')!.textContent).toBe('Series One'))
      expect(screen.queryByText('Alpha')).toBeNull()
    })

    it('shows the API’s own words and keeps the editor open when the name is refused', async () => {
      vi.mocked(api.renameGroup).mockRejectedValue(new Error('This list already has a group with such name.'))
      await open(base())

      rename('Season 2')

      expect(await screen.findByText('This list already has a group with such name.')).toBeTruthy()
      expect((screen.getByLabelText('Group name') as HTMLInputElement).value).toBe('Season 2')
    })
  })

  describe('removing an empty group', () => {
    const withEmpty = () => ({ ...base(), groups: [...groups, { id: 'g3', listId: 'L1', name: 'Season 3', orderIndex: 2 }] })

    it('deletes at once, offers Undo, and Undo brings it back with a pulse', async () => {
      const restore = { group: { id: 'g3' } }
      vi.mocked(api.deleteGroup).mockResolvedValue(restore as never)
      vi.mocked(api.restoreGroup).mockResolvedValue(withEmpty().groups[2]!)
      await open(withEmpty())

      fireEvent.click(screen.getByRole('button', { name: 'Delete this empty group' }))

      expect(document.querySelector('[data-row-id="g3"]')).toBeNull()
      expect(api.deleteGroup).toHaveBeenCalledWith('L1', 'g3')
      expect((await screen.findAllByText('Deleted group Season 3')).length).toBeGreaterThan(0)

      vi.mocked(api.list).mockResolvedValue(withEmpty())
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(document.querySelector('[data-row-id="g3"]')).not.toBeNull())
      expect(api.restoreGroup).toHaveBeenCalledWith('L1', restore)
      expect(document.querySelector('[data-row-id="g3"]')!.className).toContain('pulse')
    })

    it('puts the group back and says so when the server refuses', async () => {
      vi.mocked(api.deleteGroup).mockRejectedValue(new Error('nope'))
      await open(withEmpty())

      fireEvent.click(screen.getByRole('button', { name: 'Delete this empty group' }))

      expect(await screen.findByText('Could not delete group Season 3')).toBeTruthy()
      expect(document.querySelector('[data-row-id="g3"]')).not.toBeNull()
    })

    it('only an empty group offers it', async () => {
      await open(withEmpty())

      expect(screen.getAllByRole('button', { name: 'Delete this empty group' })).toHaveLength(1)
    })
  })

  describe('removing a group that has items (owner, 2026-09-27)', () => {
    it('asks first, stating what goes with it; Keep changes nothing', async () => {
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Delete group Season 1' }))

      const pop = await waitFor(() => document.querySelector('.q-pop') as HTMLElement)
      expect(pop.textContent).toContain('Delete “Season 1”?')
      expect(pop.textContent).toContain('2 items in this group will be deleted as well')
      fireEvent.click(within(pop).getByRole('button', { name: 'Keep' }))

      expect(api.deleteGroup).not.toHaveBeenCalled()
      expect(screen.getByText('Alpha')).toBeTruthy()
    })

    it('deletes the group and its items on confirm, and Undo brings them all back', async () => {
      const restore = { group: { id: 'g1' }, items: [{ id: 'a' }, { id: 'b' }], dismissalIds: ['d1', 'd2'] }
      vi.mocked(api.deleteGroup).mockResolvedValue(restore as never)
      vi.mocked(api.restoreGroup).mockResolvedValue(base().groups[0]!)
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Delete group Season 1' }))
      const pop = await waitFor(() => document.querySelector('.q-pop') as HTMLElement)
      fireEvent.click(within(pop).getByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(api.deleteGroup).toHaveBeenCalledWith('L1', 'g1', { withItems: true }))
      expect(screen.queryByText('Alpha')).toBeNull()
      expect(screen.queryByText('Beta')).toBeNull()
      expect(screen.getByText('Gamma')).toBeTruthy()
      expect((await screen.findAllByText('Deleted group Season 1 with 2 items')).length).toBeGreaterThan(0)

      vi.mocked(api.list).mockResolvedValue(base())
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(await screen.findByText('Alpha')).toBeTruthy()
      expect(api.restoreGroup).toHaveBeenCalledWith('L1', restore)
    })

    it('mentions the done marks that go too', async () => {
      const list = base()
      list.items[0]!.consumedAt = '2026-01-01T00:00:00Z'
      await open(list)

      fireEvent.click(screen.getByRole('button', { name: 'Delete group Season 1' }))

      const pop = await waitFor(() => document.querySelector('.q-pop') as HTMLElement)
      expect(pop.textContent).toContain('2 items, 1 done, in this group will be deleted as well')
    })
  })

  describe('removing', () => {
    it('removes at once, then offers Undo, which brings the row back with a pulse', async () => {
      const restore = { item: { id: 'b' }, dismissalId: 'd' }
      vi.mocked(api.deleteItem).mockResolvedValue(restore as never)
      vi.mocked(api.restoreItem).mockResolvedValue(base().items[1]!)
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }))

      expect(screen.queryByText('Beta')).toBeNull()
      expect(api.deleteItem).toHaveBeenCalledWith('L1', 'b')
      // The toast, and the live region that says it aloud.
      expect((await screen.findAllByText('Deleted Beta')).length).toBeGreaterThan(0)
      expect(document.querySelector('.q-toast')!.textContent).toContain('Deleted Beta')

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

      fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }))

      expect(screen.getByText('0/2 (0%)')).toBeTruthy()
    })

    it('puts the row back and says so when the server refuses', async () => {
      vi.mocked(api.deleteItem).mockRejectedValue(new ApiError('nope', 500))
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }))

      expect(await screen.findByText('Couldn\'t delete Beta')).toBeTruthy()
      expect(screen.getByText('Beta')).toBeTruthy()
    })

    it('does not toggle the row it was pressed in', async () => {
      vi.mocked(api.deleteItem).mockResolvedValue({} as never)
      await open(base())

      fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }))

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
      // A plain toast, like the list edit window's own Save (owner, 2026-09-28: U6) — no Undo on
      // an explicit, deliberate click; click-away is still the one that offers it.
      expect((await screen.findAllByText('Saved changes to Renamed')).length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
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
      // 10.33: every toast and pulse gets a live-region sentence — this Undo pulses the row but said nothing.
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Reverted last edit to Alpha'))
    })

    it('Discard changes nothing', async () => {
      await open(base())
      fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha' }))
      await screen.findByRole('dialog')

      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Don\'t Save' }))

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

      expect(await screen.findByText('Couldn\'t save those changes')).toBeTruthy()
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
      expect(screen.queryByRole('button', { name: 'Mark All As Seen' })).toBeNull()
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

      fireEvent.click(screen.getByRole('button', { name: 'Mark All As Seen' }))

      await waitFor(() => expect(screen.queryByText('NEW')).toBeNull())
      expect(api.markSeen).toHaveBeenCalledWith('L1')
      expect(screen.queryByRole('button', { name: 'Mark All As Seen' })).toBeNull()
      await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('All new items marked as seen'))
    })

    it('keeps the marks and says why when the server refuses', async () => {
      vi.mocked(api.markSeen).mockRejectedValue(new Error('down'))
      await open(withNew())

      fireEvent.click(screen.getByRole('button', { name: 'Mark All As Seen' }))

      expect(await screen.findByText('Couldn\'t mark all new items as seen')).toBeTruthy()
      expect(screen.getAllByText('NEW')).toHaveLength(2)
    })
  })

  describe('Check for updates and the found band', () => {
    const findings = (n: number, extra: object = {}) => ({
      newItems: Array.from({ length: n }, (_, i) => ({ title: `Fresh ${i}`, externalRef: `ref:${i}` })),
      upstreamCount: 10,
      existingCount: 8,
      dismissedCount: 0,
      ...extra,
    })
    const foundBand = () =>
      (Array.from(document.querySelectorAll('.q-banner')) as HTMLElement[]).find((b) => /found/.test(b.textContent ?? ''))
    const checkButton = () => screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement

    it('is offered only on a list that has a source to check', async () => {
      await open(detail({ externalRef: null, items: [item()] }))

      expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull()
    })

    it('is an icon button: the refresh glyph, named for what it does', async () => {
      await open(sourced())

      expect(checkButton().querySelector('svg')).not.toBeNull()
      expect(checkButton().textContent).toBe('')
    })

    it('shows no band, and checks nothing, until asked', async () => {
      await open(sourced())

      expect(foundBand()).toBeUndefined()
      expect(api.checkForUpdates).not.toHaveBeenCalled()
    })

    it('shows what an earlier check found, with the choice to apply or dismiss it', async () => {
      await pending.set('L1', 3)
      await open(sourced())

      expect(foundBand()!.textContent).toMatch(/3 new items found/)
      expect(within(foundBand()!).getByRole('button', { name: 'Update List' })).toBeTruthy()
      expect(within(foundBand()!).getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    })

    it('says "1 new item found" for one', async () => {
      await pending.set('L1', 1)
      await open(sourced())

      expect(foundBand()!.textContent).toMatch(/1 new item found/)
    })

    it('shows a band for a finding that arrives while it is open', async () => {
      await open(sourced())

      await act(async () => pending.set('L1', 2))

      expect(foundBand()!.textContent).toMatch(/2 new items found/)
    })

    it('the check icon finds, records, and shows the band; it adds nothing', async () => {
      vi.mocked(api.checkForUpdates).mockResolvedValue(findings(2))
      await open(sourced())

      fireEvent.click(checkButton())

      await waitFor(() => expect(foundBand()).toBeDefined())
      expect(foundBand()!.textContent).toMatch(/2 new items found/)
      expect(api.checkForUpdates).toHaveBeenCalledWith('L1', false)
      expect(api.importItems).not.toHaveBeenCalled()
      expect(pending.get()['L1']?.count).toBe(2)
    })

    it('spins, and locks itself, while it looks', async () => {
      let finish!: (value: ReturnType<typeof findings>) => void
      vi.mocked(api.checkForUpdates).mockReturnValue(new Promise((resolve) => (finish = resolve)))
      await open(sourced())

      fireEvent.click(checkButton())

      const checking = () => screen.getByRole('button', { name: 'Checking for updates…' }) as HTMLButtonElement
      await waitFor(() => expect(checking().disabled).toBe(true))
      expect(checking().getAttribute('aria-label')).toBe('Checking for updates…')
      expect(checking().querySelector('.q-spin')).not.toBeNull()
      await act(async () => finish(findings(0)))
      await waitFor(() => expect(checkButton().disabled).toBe(false))
      expect(checkButton().getAttribute('aria-label')).toBe('Check for updates')
      expect(checkButton().querySelector('.q-spin')).toBeNull()
    })

    it('answers "No updates found" with a toast when there is nothing, and clears an old band', async () => {
      await pending.set('L1', 2)
      vi.mocked(api.checkForUpdates).mockResolvedValue(findings(0))
      await open(sourced())

      fireEvent.click(checkButton())

      await waitFor(() => expect(document.querySelector('.q-toast')?.textContent).toMatch(/No updates found/))
      expect(foundBand()).toBeUndefined()
    })

    it('shows an error, and no band, when the check fails', async () => {
      vi.mocked(api.checkForUpdates).mockRejectedValue(new Error('Source is down'))
      await open(sourced())

      fireEvent.click(checkButton())

      expect(await screen.findByText('Source is down')).toBeTruthy()
      expect(foundBand()).toBeUndefined()
    })

    describe('Update List', () => {
      it('adds what is new as arrivals, then shows them as NEW under the usual band', async () => {
        await pending.set('L1', 2)
        const fresh = findings(2)
        vi.mocked(api.checkForUpdates).mockResolvedValue(fresh)
        vi.mocked(api.importItems).mockResolvedValue([])
        await open(sourced())
        vi.mocked(api.list).mockResolvedValue(
          sourced({
            items: [
              item({ id: 'a', title: 'Alpha' }),
              item({ id: 'd', title: 'Fresh 0', isNew: true }),
              item({ id: 'e', title: 'Fresh 1', isNew: true }),
            ],
          }),
        )

        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Update List' }))

        await waitFor(() => expect(screen.getAllByText('NEW')).toHaveLength(2))
        expect(api.importItems).toHaveBeenCalledWith('L1', fresh.newItems, 'import', true)
        expect(foundBand()).toBeUndefined()
        expect(screen.getByText(/2 new items were added/)).toBeTruthy()
        expect(pending.get()).toEqual({})
        expect(document.querySelector('.q-toast')!.textContent).toMatch(/Added 2 new items/)
      })

      it('adds nothing, and says so, when the source has nothing new any more', async () => {
        await pending.set('L1', 2)
        vi.mocked(api.checkForUpdates).mockResolvedValue(findings(0))
        await open(sourced())

        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Update List' }))

        await waitFor(() => expect(foundBand()).toBeUndefined())
        expect(api.importItems).not.toHaveBeenCalled()
        // The toast is raised by the same async step that clears the band, not before it.
        await waitFor(() => expect(document.querySelector('.q-toast')?.textContent).toMatch(/No updates found/))
      })

      it('keeps the band, and says why, when it fails', async () => {
        await pending.set('L1', 2)
        vi.mocked(api.checkForUpdates).mockResolvedValue(findings(2))
        vi.mocked(api.importItems).mockRejectedValue(new Error('nope'))
        await open(sourced())

        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Update List' }))

        expect(await screen.findByText('Couldn\'t add updates')).toBeTruthy()
        expect(foundBand()).toBeDefined()
      })

      it('cannot be pressed twice while it works', async () => {
        await pending.set('L1', 2)
        let release!: () => void
        vi.mocked(api.checkForUpdates).mockReturnValue(new Promise((resolve) => (release = () => resolve(findings(0)))))
        await open(sourced())

        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Update List' }))

        await waitFor(() =>
          expect((within(foundBand()!).getByRole('button', { name: 'Update List' }) as HTMLButtonElement).disabled).toBe(true),
        )
        await act(async () => release())
      })
    })

    describe('Dismiss', () => {
      it('hides the band and forgets the finding, without asking the source anything', async () => {
        await pending.set('L1', 2)
        await open(sourced())

        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Dismiss' }))

        await waitFor(() => expect(foundBand()).toBeUndefined())
        expect(pending.get()).toEqual({})
        expect(api.checkForUpdates).not.toHaveBeenCalled()
        expect(api.importItems).not.toHaveBeenCalled()
      })

      it('comes back the next time the check finds it', async () => {
        await pending.set('L1', 2)
        vi.mocked(api.checkForUpdates).mockResolvedValue(findings(2))
        await open(sourced())
        fireEvent.click(within(foundBand()!).getByRole('button', { name: 'Dismiss' }))
        await waitFor(() => expect(foundBand()).toBeUndefined())

        fireEvent.click(checkButton())

        await waitFor(() => expect(foundBand()).toBeDefined())
      })
    })
  })
})

describe('ListScreen edit list (task 10.22)', () => {
  const openEditor = async (list = detail({ items: [item()] })) => {
    await open(list)
    await pickFromMenu('Edit List')
    await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
    return within(document.querySelector('.q-pop') as HTMLElement).getByLabelText('Title')
  }
  const pop = () => within(document.querySelector('.q-pop') as HTMLElement)
  const clickAway = () => fireEvent.click(document.querySelector('.q-catcher')!)

  it('opens on the list’s own values', async () => {
    const title = (await openEditor()) as HTMLInputElement

    expect(title.value).toBe('Loki')
    expect((pop().getByLabelText(/Description/) as HTMLTextAreaElement).value).toBe('The trickster')
  })

  it('shows how many items the list has, as the other list popovers do', async () => {
    await openEditor(detail({ items: [item(), item(), item()] }))

    expect(pop().getByText('3 items')).toBeTruthy()
  })

  it('saves what changed, and the header shows it at once', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    const title = await openEditor()

    fireEvent.change(title, { target: { value: 'Loki S2' } })
    fireEvent.click(pop().getByRole('button', { name: 'Complete' }))
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('heading', { name: /^Loki S2/ })).toBeTruthy()
    expect(api.updateList).toHaveBeenCalledWith('L1', { title: 'Loki S2', status: 'complete' })
    expect(screen.getByText('Complete')).toBeTruthy()
    expect(document.querySelector('.q-pop')).toBeNull()
  })

  it('shows a changed description under the name at once', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    await openEditor()

    fireEvent.change(pop().getByLabelText(/Description/), { target: { value: 'A brand new blurb' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A brand new blurb')).toBeTruthy()
    expect(screen.queryByText('The trickster')).toBeNull()
  })

  it('removes the description line from the header when it is emptied', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    await openEditor()

    fireEvent.change(pop().getByLabelText(/Description/), { target: { value: '' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByText('The trickster')).toBeNull())
    expect(document.querySelector('.q-list-description')).toBeNull()
  })

  it('lets the progress sentence follow a changed status', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    await openEditor(detail({ items: [item({ consumedAt: '2026-01-01' })] }))
    expect(screen.getByText('✓ Done (for now)')).toBeTruthy()

    fireEvent.click(pop().getByRole('button', { name: 'Complete' }))
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('✓ All Done')).toBeTruthy()
  })

  it('says what an explicit Save did, with no Undo', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    const title = await openEditor()

    fireEvent.change(title, { target: { value: 'Loki S2' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('Renamed to “Loki S2”.')).not.toHaveLength(0)
    expect(document.querySelector('.q-toast')?.textContent).not.toMatch(/Undo/)
  })

  it('says what changed when it is one thing: only the description, or only the status', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    await openEditor()
    fireEvent.change(pop().getByLabelText(/Description/), { target: { value: 'New blurb' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('Description updated')).not.toHaveLength(0)
  })

  it('never says only "Description updated" when the status changed too: it says the list was updated', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    await openEditor()
    fireEvent.change(pop().getByLabelText(/Description/), { target: { value: 'New blurb' } })
    fireEvent.click(pop().getByRole('button', { name: 'Complete' }))
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('List updated')).not.toHaveLength(0)
    expect(screen.queryByText('Description updated')).toBeNull()
    expect(api.updateList).toHaveBeenCalledWith('L1', { description: 'New blurb', status: 'complete' })
  })

  it('says the list was updated when the title and the description changed together', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    const title = await openEditor()
    fireEvent.change(title, { target: { value: 'Loki S2' } })
    fireEvent.change(pop().getByLabelText(/Description/), { target: { value: 'New blurb' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('List updated')).not.toHaveLength(0)
    expect(screen.queryByText(/^Renamed to/)).toBeNull()
  })

  it('click-away commits too, with an Undo that puts the old values back', async () => {
    vi.mocked(api.updateList).mockResolvedValue({} as never)
    const title = await openEditor()

    fireEvent.change(title, { target: { value: 'Loki S2' } })
    clickAway()
    await screen.findByRole('heading', { name: /^Loki S2/ })
    fireEvent.click(within(document.querySelector('.q-toast') as HTMLElement).getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(api.updateList).toHaveBeenLastCalledWith('L1', { title: 'Loki' }))
    expect(await screen.findByRole('heading', { name: /^Loki/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Loki S2/ })).toBeNull()
  })

  it('changes nothing, and writes nothing, when discarded', async () => {
    const title = await openEditor()

    fireEvent.change(title, { target: { value: 'Typed' } })
    fireEvent.click(pop().getByRole('button', { name: 'Don\'t Save' }))

    expect(api.updateList).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: /^Loki/ })).toBeTruthy()
  })

  it('keeps the old header and says so when the server refuses', async () => {
    vi.mocked(api.updateList).mockRejectedValue(new Error('no'))
    const title = await openEditor()

    fireEvent.change(title, { target: { value: 'Loki S2' } })
    fireEvent.click(pop().getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Couldn\'t save your changes to this list')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^Loki S2/ })).toBeNull()
  })
})

describe('ListScreen more menu (task 10.22)', () => {
  const two = () =>
    detail({
      items: [item({ id: 'a', title: 'Alpha', consumedAt: '2026-01-01' }), item({ id: 'b', title: 'Beta' })],
      mediaType: 'tv',
    })
  const openMenu = async (list = two()) => {
    await open(list)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
  }
  const pop = () => within(document.querySelector('.q-pop') as HTMLElement)

  describe('export', () => {
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    afterEach(() => {
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
    })

    it('downloads the list as a YAML file named for it', async () => {
      const blobs: Blob[] = []
      URL.createObjectURL = vi.fn((blob: Blob) => (blobs.push(blob), 'blob:x'))
      URL.revokeObjectURL = vi.fn()
      const names: string[] = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download)
      })
      await openMenu()

      fireEvent.click(pop().getByRole('button', { name: 'Export List' }))
      fireEvent.click(pop().getByRole('button', { name: 'Download File' }))

      expect(names).toEqual(['Loki.yaml'])
      const text = await blobs[0]!.text()
      expect(text).toMatch(/^title: Loki$/m)
      expect(text).toMatch(/^category: tv$/m)
      expect(text).toMatch(/Alpha/)
      // Progress is never part of the file.
      expect(text).not.toMatch(/consumed|2026/)
      expect(await screen.findAllByText('Saved Loki.yaml — 2 items.')).not.toHaveLength(0)
    })

    it('exports the list as it is now, including a rename made on this screen', async () => {
      vi.mocked(api.updateList).mockResolvedValue({} as never)
      const written: string[] = []
      Object.assign(navigator, { clipboard: { writeText: vi.fn(async (t: string) => void written.push(t)) } })
      await open(two())
      await pickFromMenu('Edit List')
      await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
      fireEvent.change(pop().getByLabelText('Title'), { target: { value: 'Renamed' } })
      fireEvent.click(pop().getByRole('button', { name: 'Save' }))
      await screen.findByRole('heading', { name: /^Renamed/ })

      await pickFromMenu('Export List')
      fireEvent.click(pop().getByRole('button', { name: 'Copy To Clipboard' }))

      await waitFor(() => expect(written).toHaveLength(1))
      expect(written[0]).toMatch(/^title: Renamed$/m)
      expect(await screen.findAllByText('YAML list copied to your clipboard')).not.toHaveLength(0)
      // Done with it: the popover closes.
      expect(document.querySelector('.q-pop')).toBeNull()
    })

    it('says so when the clipboard refuses', async () => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
      await openMenu()

      fireEvent.click(pop().getByRole('button', { name: 'Export List' }))
      fireEvent.click(pop().getByRole('button', { name: 'Copy To Clipboard' }))

      expect(await screen.findAllByText('Couldn\'t copy to clipboard. Try Download File instead?')).not.toHaveLength(0)
    })
  })

  describe('delete', () => {
    const restore = { list: { id: 'L1', title: 'Loki' }, items: [], groups: [], snapshot: [], dismissals: [] }

    it('asks first, with the cost, and does nothing until told to', async () => {
      await openMenu()

      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      expect(pop().getByText('Delete “Loki”?')).toBeTruthy()
      expect(pop().getByText('2 items (1 done) will be gone like a turd in the wind')).toBeTruthy()
      expect(api.deleteList).not.toHaveBeenCalled()
    })

    it('Keep leaves the list alone', async () => {
      await openMenu()
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      fireEvent.click(pop().getByRole('button', { name: 'Keep List' }))

      expect(api.deleteList).not.toHaveBeenCalled()
      expect(onLeave).not.toHaveBeenCalled()
      expect(document.querySelector('.q-pop')).toBeNull()
    })

    it('deletes, leaves the screen, and offers Undo', async () => {
      vi.mocked(api.deleteList).mockResolvedValue(restore as never)
      await openMenu()
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1))
      expect(api.deleteList).toHaveBeenCalledWith('L1')
      const toast = document.querySelector('.q-toast') as HTMLElement
      expect(toast.textContent).toMatch(/Deleted “Loki”\./)
      expect(within(toast).getByRole('button', { name: 'Undo' })).toBeTruthy()
    })

    it('Undo puts the list back with the payload the delete handed over, and tells Home', async () => {
      vi.mocked(api.deleteList).mockResolvedValue(restore as never)
      vi.mocked(api.restoreList).mockResolvedValue({} as never)
      const heard = vi.fn()
      const off = subscribeListsChanged(heard)
      await openMenu()
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))
      await waitFor(() => expect(onLeave).toHaveBeenCalled())

      fireEvent.click(within(document.querySelector('.q-toast') as HTMLElement).getByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(api.restoreList).toHaveBeenCalledWith(restore))
      await waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
      off()
    })

    it('says so, and stays, when the delete fails', async () => {
      vi.mocked(api.deleteList).mockRejectedValue(new Error('no'))
      await openMenu()
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))

      expect(await screen.findByText('Sudden iddqd detected: couldn\'t delete this list')).toBeTruthy()
      expect(onLeave).not.toHaveBeenCalled()
    })

    it('says so when the Undo cannot restore it', async () => {
      vi.mocked(api.deleteList).mockResolvedValue(restore as never)
      vi.mocked(api.restoreList).mockRejectedValue(new Error('exists'))
      await openMenu()
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))
      fireEvent.click(pop().getByRole('button', { name: 'Delete List' }))
      await waitFor(() => expect(onLeave).toHaveBeenCalled())

      fireEvent.click(within(document.querySelector('.q-toast') as HTMLElement).getByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(document.querySelector('.q-toast')!.textContent).toMatch(/Necromancy failure detected: couldn't restore the list/))
    })
  })
})

describe('ListScreen order menu (task 10.22)', () => {
  const sourced = (over: Partial<MediaListDetail> = {}) =>
    detail({
      source: 'api',
      externalRef: 'tmdb:1',
      mediaType: 'tv',
      items: [item({ id: 'a', title: 'Alpha', orderIndex: 0 }), item({ id: 'b', title: 'Beta', orderIndex: 1 })],
      ...over,
    })
  const pop = () => within(document.querySelector('.q-pop') as HTMLElement)
  const openOrder = async (list = sourced()) => {
    await open(list)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
  }
  /** Reorder List asks first (prototype), then Sort now does it. */
  const sortNow = () => {
    fireEvent.click(pop().getByRole('button', { name: 'Reorder List' }))
    fireEvent.click(pop().getByRole('button', { name: 'Sort by release date' }))
  }
  const rowTitles = () => Array.from(document.querySelectorAll('.q-item .title')).map((n) => n.textContent)
  const undoOnToast = () =>
    fireEvent.click(within(document.querySelector('.q-toast') as HTMLElement).getByRole('button', { name: 'Undo' }))

  describe('Sort chronologically', () => {
    it('sorts at once, shows the new order, and offers Undo', async () => {
      vi.mocked(api.sortList).mockResolvedValue({ restore: { items: [], groups: [] } })
      await openOrder()
      vi.mocked(api.list).mockResolvedValue(
        sourced({ items: [item({ id: 'b', title: 'Beta', orderIndex: 0 }), item({ id: 'a', title: 'Alpha', orderIndex: 1 })] }),
      )

      sortNow()

      await waitFor(() => expect(rowTitles()).toEqual(['Beta', 'Alpha']))
      expect(api.sortList).toHaveBeenCalledWith('L1')
      expect(document.querySelector('.q-pop')).toBeNull()
      expect(document.querySelector('.q-toast')!.textContent).toMatch(/Sorted by date/)
    })

    it('Undo posts back the payload the sort handed over, and shows the old order', async () => {
      const restore = { items: [{ id: 'a', orderIndex: 0 }], groups: [] }
      vi.mocked(api.sortList).mockResolvedValue({ restore })
      vi.mocked(api.restoreOrder).mockResolvedValue(undefined)
      await openOrder()
      vi.mocked(api.list).mockResolvedValue(
        sourced({ items: [item({ id: 'b', title: 'Beta', orderIndex: 0 }), item({ id: 'a', title: 'Alpha', orderIndex: 1 })] }),
      )
      sortNow()
      await waitFor(() => expect(rowTitles()).toEqual(['Beta', 'Alpha']))
      vi.mocked(api.list).mockResolvedValue(sourced())

      undoOnToast()

      await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledWith('L1', restore))
      await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Beta']))
    })

    it('says so, and changes nothing, when the sort fails', async () => {
      vi.mocked(api.sortList).mockRejectedValue(new Error('no'))
      await openOrder()

      sortNow()

      expect(await screen.findByText('Couldn\'t sort this list')).toBeTruthy()
      expect(rowTitles()).toEqual(['Alpha', 'Beta'])
    })
  })

  describe('Reset to the source', () => {
    const restore = { items: [], dismissals: [], groups: [], list: { title: 'Loki', description: 'The trickster', status: 'ongoing' as const } }
    const result = (followUpCheck: boolean) => ({
      counts: { removed: 1, restored: 0, doneCleared: 0 },
      followUpCheck,
      restore,
    })
    const preview = { removed: 3, restored: 1, doneCleared: 12, followUpCheck: true }
    const openReset = async (list = sourced()) => {
      await openOrder(list)
      fireEvent.click(pop().getByRole('button', { name: 'Reset List' }))
    }

    it('is not offered on a hand-made list', async () => {
      await openOrder(detail({ source: 'manual', items: [item()] }))

      expect(pop().queryByRole('button', { name: 'Reset List' })).toBeNull()
    })

    it('works out the cost first, and says it in words before any button is pressed', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)

      await openReset()

      expect(await pop().findByText(/3 items you added will be removed, 1 item you removed will come back and 12 done marks will be cleared\./)).toBeTruthy()
      expect(api.resetPreview).toHaveBeenCalledWith('L1')
      expect(api.resetList).not.toHaveBeenCalled()
    })

    it('ignores a slow answer for an earlier opening of the question', async () => {
      let finishFirst!: (value: typeof preview) => void
      vi.mocked(api.resetPreview)
        .mockReturnValueOnce(new Promise((resolve) => (finishFirst = resolve)))
        .mockResolvedValueOnce({ removed: 5, restored: 0, doneCleared: 0, followUpCheck: true })
      await openReset()
      fireEvent.click(document.querySelector('.q-catcher')!)
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      await waitFor(() => expect(document.querySelector('.q-pop')).not.toBeNull())
      fireEvent.click(pop().getByRole('button', { name: 'Reset List' }))
      await pop().findByText(/5 items you added will be removed/)

      await act(async () => finishFirst({ removed: 99, restored: 0, doneCleared: 0, followUpCheck: true }))

      expect(pop().queryByText(/99 items/)).toBeNull()
      expect(pop().getByText(/5 items you added will be removed/)).toBeTruthy()
    })

    it('shows why the numbers are missing, and still allows the reset', async () => {
      vi.mocked(api.resetPreview).mockRejectedValue(new Error('Source is down'))

      await openReset()

      expect(await pop().findByText(/Could not work out what would change \(Source is down\)/)).toBeTruthy()
      expect((pop().getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('Reset resets, shows the list as the source has it, and offers Undo', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)
      vi.mocked(api.resetList).mockResolvedValue(result(false))
      await openReset()
      await pop().findByText(/12 done marks/)
      vi.mocked(api.list).mockResolvedValue(
        sourced({ title: 'Loki (source)', description: 'From the source', status: 'complete', items: [item({ id: 'z', title: 'Zeta' })] }),
      )

      fireEvent.click(pop().getByRole('button', { name: 'Reset' }))

      expect(await screen.findByRole('heading', { name: /^Loki \(source\)/ })).toBeTruthy()
      expect(screen.getByText('From the source')).toBeTruthy()
      expect(rowTitles()).toEqual(['Zeta'])
      expect(api.resetList).toHaveBeenCalledWith('L1')
      expect(document.querySelector('.q-toast')!.textContent).toMatch(/Reset to the source/)
    })

    it('Undo restores the whole item set from the payload, and the name it had', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)
      vi.mocked(api.resetList).mockResolvedValue(result(false))
      vi.mocked(api.restoreItems).mockResolvedValue([])
      await openReset()
      await pop().findByText(/12 done marks/)
      vi.mocked(api.list).mockResolvedValue(sourced({ title: 'Loki (source)', items: [item({ id: 'z', title: 'Zeta' })] }))
      fireEvent.click(pop().getByRole('button', { name: 'Reset' }))
      await screen.findByRole('heading', { name: /^Loki \(source\)/ })
      vi.mocked(api.list).mockResolvedValue(sourced())

      undoOnToast()

      await waitFor(() => expect(api.restoreItems).toHaveBeenCalledWith('L1', restore))
      expect(await screen.findByRole('heading', { name: /^Loki(?! \()/ })).toBeTruthy()
      await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Beta']))
    })

    it('an API list then checks for updates by itself, and shows what it found as a band', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)
      vi.mocked(api.resetList).mockResolvedValue(result(true))
      vi.mocked(api.checkForUpdates).mockResolvedValue({
        newItems: [{ title: 'Fresh', externalRef: 'r' }],
        upstreamCount: 3,
        existingCount: 2,
        dismissedCount: 0,
      })
      await openReset()
      await pop().findByText(/12 done marks/)

      fireEvent.click(pop().getByRole('button', { name: 'Reset' }))

      await waitFor(() => expect(document.body.textContent).toMatch(/1 new item found/))
      expect(api.checkForUpdates).toHaveBeenCalledWith('L1', false)
      expect(api.importItems).not.toHaveBeenCalled()
    })

    it('runs no update check when the source was just read live', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)
      vi.mocked(api.resetList).mockResolvedValue(result(false))
      await openReset()
      await pop().findByText(/12 done marks/)

      fireEvent.click(pop().getByRole('button', { name: 'Reset' }))
      await waitFor(() => expect(api.resetList).toHaveBeenCalled())
      await act(async () => {})

      expect(api.checkForUpdates).not.toHaveBeenCalled()
    })

    /** Restore source order lives in Reorder List now (11.14): it asks nothing, and does not touch the reset. */
    const restoreSourceOrder = () => {
      fireEvent.click(pop().getByRole('button', { name: 'Reorder List' }))
      fireEvent.click(pop().getByRole('button', { name: 'Restore source order' }))
    }

    it('Restore source order puts the source order back: not the year sort, and not Reset', async () => {
      vi.mocked(api.resetOrder).mockResolvedValue({ restore: { items: [], groups: [] } })
      await openOrder()

      restoreSourceOrder()

      await waitFor(() => expect(api.resetOrder).toHaveBeenCalledWith('L1'))
      expect(api.sortList).not.toHaveBeenCalled()
      expect(api.resetList).not.toHaveBeenCalled()
      await waitFor(() => expect(document.querySelector('.q-toast')!.textContent).toMatch(/Source order restored/))
    })

    it('Undo of Restore source order puts the old positions back', async () => {
      const restore = { items: [{ id: 'a', orderIndex: 3 }], groups: [] }
      vi.mocked(api.resetOrder).mockResolvedValue({ restore })
      vi.mocked(api.restoreOrder).mockResolvedValue(undefined)
      await openOrder()

      restoreSourceOrder()
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

      await waitFor(() => expect(api.restoreOrder).toHaveBeenCalledWith('L1', restore))
    })

    it('says why when the source order cannot be restored', async () => {
      vi.mocked(api.resetOrder).mockRejectedValue(new Error('This list has no source to reset to'))
      await openOrder()

      restoreSourceOrder()

      expect(await screen.findByText('This list has no source to reset to')).toBeTruthy()
    })

    it('says why, and changes nothing, when the reset is refused', async () => {
      vi.mocked(api.resetPreview).mockResolvedValue(preview)
      vi.mocked(api.resetList).mockRejectedValue(new Error('This list has no source to reset to'))
      await openReset()
      await pop().findByText(/12 done marks/)

      fireEvent.click(pop().getByRole('button', { name: 'Reset' }))

      expect(await screen.findByText('This list has no source to reset to')).toBeTruthy()
      expect(rowTitles()).toEqual(['Alpha', 'Beta'])
    })
  })
})
