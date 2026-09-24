// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError, api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
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

  return { ApiError: MockApiError, api: { list: vi.fn(), setConsumed: vi.fn() } }
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

async function open(list: MediaListDetail) {
  vi.mocked(api.list).mockResolvedValue(list)
  render(<ListScreen listId={list.id} mediaTypes={TYPES} />)
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

    for (const name of ['Edit list', 'Check for updates', 'Order', 'More']) {
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
    render(<ListScreen listId="L1" mediaTypes={TYPES} />)

    expect(screen.getByText('Loading the list…')).toBeTruthy()
    await act(async () => resolve(detail({ items: [item({ title: 'Only' })] })))

    expect(await screen.findByText('Only')).toBeTruthy()
  })

  it('says so when the list cannot be loaded, and Retry loads it again', async () => {
    vi.mocked(api.list).mockRejectedValueOnce(new ApiError('Server is down', 0))
    vi.mocked(api.list).mockResolvedValueOnce(detail({ items: [item({ title: 'Back' })] }))
    render(<ListScreen listId="L1" mediaTypes={TYPES} />)

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
