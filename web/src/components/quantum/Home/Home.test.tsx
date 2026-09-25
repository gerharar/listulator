// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { MediaList, MediaType } from '../../../lib/api.js'
import { api } from '../../../lib/api.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ToastProvider } from '../Toast/Toast.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { Home } from './Home.js'

vi.mock('../../../lib/api.js', () => ({
  api: {
    mediaTypes: vi.fn(),
    lists: vi.fn(),
    checkSyncedListUpdates: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const MEDIA_TYPES: MediaType[] = [
  { key: 'tv', label: 'TV Shows', sortOrder: 1, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
]

function list(overrides: Partial<MediaList> = {}): MediaList {
  return {
    id: 'list-1',
    title: 'Breaking Bad',
    description: null,
    mediaType: 'tv',
    source: 'canonical',
    externalRef: null,
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: {
      totalItems: 62,
      consumedItems: 40,
      newItems: 0,
      completionPercent: 65,
      timeRemainingMinutes: 900,
      lastConsumedAt: null,
    },
    ...overrides,
  }
}

function StackReader() {
  const { stack } = useLayerStack()
  return <span data-testid="stack">{stack.map((layer) => `${layer.kind}:${layer.id}`).join(',')}</span>
}

function StackContent() {
  const { stack } = useLayerStack()
  return <span data-testid="content">{stack.at(-1)?.content}</span>
}

function renderHome(onMediaTypesLoaded = vi.fn()) {
  return render(
    <LiveRegionProvider>
      <ToastProvider>
        <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
          <StackReader />
          <StackContent />
          <Home onMediaTypesLoaded={onMediaTypesLoaded} />
        </LayerStackProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
}

describe('Home', () => {
  it("shows a real list's row with its counts, status mark, and curated star", async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    expect(screen.getByText('40/62 (65%)')).not.toBeNull()
    expect(document.querySelector('.q-star')).not.toBeNull()
    expect(document.querySelector('.q-status-mark')).not.toBeNull()
  })

  it('lifts the loaded media-type registry up to the caller', async () => {
    const onMediaTypesLoaded = vi.fn()
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome(onMediaTypesLoaded)

    await waitFor(() => expect(onMediaTypesLoaded).toHaveBeenCalledWith(MEDIA_TYPES))
  })

  it("names a real updated list in the banner, and it's on until dismissed", async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({
      updates: [{ listId: 'list-1', title: 'Breaking Bad' }],
    })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad', { selector: 'b' })).not.toBeNull())
    expect(screen.getByText(/1 list has an update available/)).not.toBeNull()

    act(() => screen.getByRole('button', { name: 'Dismiss' }).click())
    expect(screen.queryByText(/1 list has an update available/)).toBeNull()
  })

  it('shows how many of a list’s items are new, on its row', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([
      list({ stats: { ...list().stats, newItems: 2 } }),
      list({ id: 'list-2', title: 'Other' }),
    ])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByText('2 NEW')).not.toBeNull())
    expect(screen.getAllByText(/NEW/)).toHaveLength(1)
  })

  it('opens the updated list from the banner, carrying the update on the layer’s own path', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({
      updates: [{ listId: 'list-1', title: 'Breaking Bad' }],
    })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad', { selector: 'b' })).not.toBeNull())
    const inBanner = document.querySelector('.q-banner') as HTMLElement
    act(() => within(inBanner).getByRole('button', { name: 'Breaking Bad' }).click())

    expect(screen.getByTestId('stack').textContent).toBe('home:home,list:list-list-1')
    expect(screen.getByTestId('content').textContent).toBe('/lists/list-1?update=1')
  })

  it('opens a list from its row with no update on the path', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({
      updates: [{ listId: 'list-1', title: 'Breaking Bad' }],
    })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad', { selector: 'b' })).not.toBeNull())
    const row = document.querySelector('.q-home-row') as HTMLElement
    act(() => row.click())

    expect(screen.getByTestId('content').textContent).toBe('/lists/list-1')
  })

  it('opening a row pushes the real list onto the layer stack, with its real title as the tab label', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    act(() => screen.getByRole('button', { name: /Breaking Bad/ }).click())

    expect(screen.getByTestId('stack').textContent).toBe('home:home,list:list-list-1')
  })

  it("surfaces a list whose category was removed from the registry, instead of letting it vanish", async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([
      list({ id: 'list-1', title: 'Breaking Bad', mediaType: 'tv' }),
      list({ id: 'list-2', title: 'Some Podcast', mediaType: 'podcast' }),
    ])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByText('Some Podcast')).not.toBeNull())
    expect(screen.getByText('Uncategorised')).not.toBeNull()
    expect(screen.getByText('category no longer exists')).not.toBeNull()
  })

  it('shows an ErrorBlock, not the create flow, when the server is unreachable', async () => {
    vi.mocked(api.mediaTypes).mockRejectedValue(new Error('Cannot reach the server. Is it running?'))
    vi.mocked(api.lists).mockRejectedValue(new Error('Cannot reach the server. Is it running?'))
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Is it running?')).not.toBeNull(),
    )
    expect(screen.getByTestId('stack').textContent).toBe('home:home')
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
  })

  it('retries the fetch when Retry is clicked', async () => {
    vi.mocked(api.mediaTypes).mockRejectedValueOnce(new Error('down')).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockRejectedValueOnce(new Error('down')).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull())
    act(() => screen.getByRole('button', { name: 'Retry' }).click())

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
  })

  it('a successful zero-lists fetch replaces the base layer with the Category picker — never after an error', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() =>
      expect(screen.getByTestId('stack').textContent).toBe('category-picker:category-picker'),
    )
  })

  it('New List pushes the Category picker on top of Home', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    act(() => screen.getByRole('button', { name: 'New List' }).click())

    expect(screen.getByTestId('stack').textContent).toBe('home:home,category-picker:category-picker')
  })

  it('shows the four disabled help buttons, and no others', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())

    for (const label of ["I'm Tired, Boss", 'Finalizer', 'Just One Fix', 'Surprise Me']) {
      const button = screen.getByRole('button', { name: label })
      expect(button.hasAttribute('disabled')).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quickie' })).toBeNull()
  })

  it('reports a failed manual update check as a toast, not an inline error, and keeps the automatic check silent', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    vi.mocked(api.checkSyncedListUpdates)
      .mockResolvedValueOnce({ updates: [] }) // the automatic, on-open check
      .mockRejectedValueOnce(new Error('Cannot reach the server. Is it running?'))

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    // The silent automatic check already ran and failed nothing — no error anywhere yet.
    expect(screen.queryByText(/Cannot reach the server/)).toBeNull()

    act(() => screen.getByRole('button', { name: 'Check for updates' }).click())

    await waitFor(() =>
      expect(screen.getByText('Cannot reach the server. Is it running?')).not.toBeNull(),
    )
    // Reported as a toast (role="status" via LiveRegion/Toast), not folded into Home's own body.
    expect(document.querySelector('.q-error-block')).toBeNull()
  })

  it('refetches when Home becomes the top layer again, not just on first mount', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValueOnce([list()]).mockResolvedValueOnce([
      list({ id: 'list-2', title: 'The Wire' }),
    ])
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    function Harness() {
      const layerStack = useLayerStack()
      return (
        <>
          <StackReader />
          <button onClick={() => layerStack.push({ id: 'x', kind: 'list', tabLabel: 'x', content: '/x' })}>
            cover home
          </button>
          <button onClick={() => layerStack.popToIndex(0)}>back to home</button>
          <Home onMediaTypesLoaded={vi.fn()} />
        </>
      )
    }

    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <Harness />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    act(() => screen.getByText('cover home').click())
    act(() => screen.getByText('back to home').click())

    await waitFor(() => expect(screen.getByText('The Wire')).not.toBeNull())
    expect(vi.mocked(api.lists)).toHaveBeenCalledTimes(2)
  })

  it('revalidates on return silently — the already-rendered row never disappears behind a loading state', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    let resolveSecondFetch!: (value: MediaList[]) => void
    vi.mocked(api.lists)
      .mockResolvedValueOnce([list()])
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecondFetch = resolve)))
    vi.mocked(api.checkSyncedListUpdates).mockResolvedValue({ updates: [] })

    function Harness() {
      const layerStack = useLayerStack()
      return (
        <>
          <button onClick={() => layerStack.push({ id: 'x', kind: 'list', tabLabel: 'x', content: '/x' })}>
            cover home
          </button>
          <button onClick={() => layerStack.popToIndex(0)}>back to home</button>
          <Home onMediaTypesLoaded={vi.fn()} />
        </>
      )
    }

    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <Harness />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    act(() => screen.getByText('cover home').click())
    act(() => screen.getByText('back to home').click())

    // The revalidating fetch is still pending — the old row and the rest of
    // Home's chrome (help row, "Need help?") must still be there, and no
    // loading placeholder should have taken their place.
    expect(screen.getByText('Breaking Bad')).not.toBeNull()
    expect(screen.getByText('Need help?')).not.toBeNull()
    expect(screen.queryByText('Loading…')).toBeNull()

    await act(async () => resolveSecondFetch([list({ id: 'list-2', title: 'The Wire' })]))

    await waitFor(() => expect(screen.getByText('The Wire')).not.toBeNull())
  })
})
