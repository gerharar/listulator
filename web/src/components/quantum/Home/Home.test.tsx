// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { MediaList, MediaType } from '../../../lib/api.js'
import { api } from '../../../lib/api.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ToastProvider } from '../Toast/Toast.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { notifyListsChanged } from '../../../lib/listsChanged.js'
import { createPendingUpdates, type PendingUpdates } from '../../../lib/pendingUpdates.js'
import type { PreferencesStore } from '../../../lib/preferences/store.js'
import { Home } from './Home.js'

vi.mock('../../../lib/api.js', () => ({
  api: {
    mediaTypes: vi.fn(),
    lists: vi.fn(),
    checkForUpdates: vi.fn(),
    importItems: vi.fn(),
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

function memoryStore(initial: Record<string, string> = {}): PreferencesStore {
  const data = new Map(Object.entries(initial))
  return { get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) }
}

const stored = (entries: Record<string, number>) => ({
  'updates:pending': JSON.stringify(
    Object.fromEntries(Object.entries(entries).map(([id, count]) => [id, { count, checkedAt: '2026-01-01T00:00:00.000Z' }])),
  ),
})

async function pendingWith(entries: Record<string, number> = {}, store = memoryStore(stored(entries))) {
  const pending = createPendingUpdates(store)
  await pending.load()
  return { pending, store }
}

function renderHome(onMediaTypesLoaded = vi.fn(), pending?: PendingUpdates) {
  return render(
    <LiveRegionProvider>
      <ToastProvider>
        <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
          <StackReader />
          <StackContent />
          <Home onMediaTypesLoaded={onMediaTypesLoaded} {...(pending ? { pendingUpdates: pending } : {})} />
        </LayerStackProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
}

describe('Home', () => {
  it("shows a real list's row with its counts, status mark, and curated star", async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])

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

    renderHome(onMediaTypesLoaded)

    await waitFor(() => expect(onMediaTypesLoaded).toHaveBeenCalledWith(MEDIA_TYPES))
  })

  it('shows how many of a list’s items are new, on its row', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([
      list({ stats: { ...list().stats, newItems: 2 } }),
      list({ id: 'list-2', title: 'Other' }),
    ])

    renderHome()

    await waitFor(() => expect(screen.getByText('2 NEW')).not.toBeNull())
    expect(screen.getAllByText(/NEW/)).toHaveLength(1)
  })

  it('refetches quietly when something elsewhere says the lists changed', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])
    renderHome()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    vi.mocked(api.lists).mockResolvedValue([list(), list({ id: 'list-2', title: 'Restored One' })])

    act(() => notifyListsChanged())

    await waitFor(() => expect(screen.getByText('Restored One')).not.toBeNull())
    expect(screen.getByText('Breaking Bad')).not.toBeNull()
  })

  it('opening a row pushes the real list onto the layer stack, with its real title as the tab label', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])

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

    renderHome()

    await waitFor(() => expect(screen.getByText('Some Podcast')).not.toBeNull())
    expect(screen.getByText('Uncategorised')).not.toBeNull()
    expect(screen.getByText('category no longer exists')).not.toBeNull()
  })

  it('shows an ErrorBlock, not the create flow, when the server is unreachable', async () => {
    vi.mocked(api.mediaTypes).mockRejectedValue(new Error('Cannot reach the server. Is it running?'))
    vi.mocked(api.lists).mockRejectedValue(new Error('Cannot reach the server. Is it running?'))

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

    renderHome()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull())
    act(() => screen.getByRole('button', { name: 'Retry' }).click())

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
  })

  it('a successful zero-lists fetch replaces the base layer with the Category picker — never after an error', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([])

    renderHome()

    await waitFor(() =>
      expect(screen.getByTestId('stack').textContent).toBe('category-picker:category-picker'),
    )
  })

  it('New List pushes the Category picker on top of Home', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])

    renderHome()
    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())
    act(() => screen.getByRole('button', { name: 'New List' }).click())

    expect(screen.getByTestId('stack').textContent).toBe('home:home,category-picker:category-picker')
  })

  it('shows the four disabled help buttons, and no others', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue([list()])

    renderHome()

    await waitFor(() => expect(screen.getByText('Breaking Bad')).not.toBeNull())

    for (const label of ["I'm Tired, Boss", 'Finalizer', 'Just One Fix', 'Surprise Me']) {
      const button = screen.getByRole('button', { name: label })
      expect(button.hasAttribute('disabled')).toBe(true)
    }
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quickie' })).toBeNull()
  })

  it('refetches when Home becomes the top layer again, not just on first mount', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValueOnce([list()]).mockResolvedValueOnce([
      list({ id: 'list-2', title: 'The Wire' }),
    ])

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

describe('Home updates (task 10.22c)', () => {
  const two = (id: string, title: string, over: Partial<MediaList> = {}) =>
    list({ id, title, externalRef: `ref:${id}`, ...over })
  const found = (n: number) => ({
    newItems: Array.from({ length: n }, (_, i) => ({ title: `New ${i}` })),
    upstreamCount: 10,
    existingCount: 8,
    dismissedCount: 0,
  })
  const setupLists = (lists: MediaList[]) => {
    vi.mocked(api.mediaTypes).mockResolvedValue(MEDIA_TYPES)
    vi.mocked(api.lists).mockResolvedValue(lists)
  }
  const bands = () => Array.from(document.querySelectorAll('.q-banner')) as HTMLElement[]
  const bandFor = (title: string) => bands().find((b) => b.textContent?.includes(title))

  it('checks nothing by itself when it opens', async () => {
    setupLists([two('a', 'Alpha')])
    const { pending } = await pendingWith()

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())
    expect(api.checkForUpdates).not.toHaveBeenCalled()
    expect(bands()).toHaveLength(0)
  })

  it('shows what an earlier check found, with the choice to apply or dismiss it', async () => {
    setupLists([two('a', 'Alpha')])
    const { pending } = await pendingWith({ a: 2 })

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(bandFor('Alpha')).toBeDefined())
    const band = within(bandFor('Alpha')!)
    expect(band.getByText('Alpha', { selector: 'b' })).not.toBeNull()
    expect(bandFor('Alpha')!.textContent).toMatch(/has 2 new items\./)
    expect(band.getByRole('button', { name: 'Update List' })).not.toBeNull()
    expect(band.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
  })

  it('says "1 new item" for one', async () => {
    setupLists([two('a', 'Alpha')])
    const { pending } = await pendingWith({ a: 1 })

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(bandFor('Alpha')!.textContent).toMatch(/has 1 new item\./))
  })

  it('shows at most three bands, in the order the lists are shown, and the next when one is handled', async () => {
    setupLists([two('a', 'Alpha'), two('b', 'Bravo'), two('c', 'Charlie'), two('d', 'Delta')])
    const { pending } = await pendingWith({ a: 1, b: 1, c: 1, d: 1 })

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(bands()).toHaveLength(3))
    expect(bands().map((b) => b.querySelector('b')!.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie'])

    act(() => within(bandFor('Bravo')!).getByRole('button', { name: 'Dismiss' }).click())

    await waitFor(() => expect(bands().map((b) => b.querySelector('b')!.textContent)).toEqual(['Alpha', 'Charlie', 'Delta']))
  })

  it('picks the first three by how the lists are shown on screen, shelf by shelf, not by how they were stored', async () => {
    vi.mocked(api.mediaTypes).mockResolvedValue([
      { key: 'tv', label: 'TV Shows', sortOrder: 20, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
      { key: 'movie', label: 'Movies', sortOrder: 10, defaultDurationMinutes: 90, searchAvailable: true, previewable: true },
    ])
    vi.mocked(api.lists).mockResolvedValue([
      two('a', 'Alpha'),
      two('b', 'Bravo'),
      two('c', 'Charlie'),
      two('m', 'Movie One', { mediaType: 'movie' }),
    ])
    const { pending } = await pendingWith({ a: 1, b: 1, c: 1, m: 1 })

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(bands()).toHaveLength(3))
    expect(bands().map((b) => b.querySelector('b')!.textContent)).toEqual(['Movie One', 'Alpha', 'Bravo'])
  })

  it('dismissing forgets the update, and it stays gone after a restart', async () => {
    setupLists([two('a', 'Alpha')])
    const { pending, store } = await pendingWith({ a: 2 })
    renderHome(vi.fn(), pending)
    await waitFor(() => expect(bandFor('Alpha')).toBeDefined())

    act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Dismiss' }).click())
    await waitFor(() => expect(bands()).toHaveLength(0))

    cleanup()
    const restarted = createPendingUpdates(store)
    await restarted.load()
    renderHome(vi.fn(), restarted)
    await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())
    expect(bands()).toHaveLength(0)
  })

  it('remembers what a check found across a restart', async () => {
    setupLists([two('a', 'Alpha')])
    const store = memoryStore()
    const first = createPendingUpdates(store)
    await first.load()
    await first.set('a', 3)

    const restarted = createPendingUpdates(store)
    await restarted.load()
    renderHome(vi.fn(), restarted)

    await waitFor(() => expect(bandFor('Alpha')!.textContent).toMatch(/has 3 new items/))
  })

  it('forgets a pending update for a list that is gone', async () => {
    setupLists([two('a', 'Alpha')])
    const { pending } = await pendingWith({ a: 1, gone: 4 })

    renderHome(vi.fn(), pending)

    await waitFor(() => expect(Object.keys(pending.get())).toEqual(['a']))
  })

  describe('Update List', () => {
    it('adds what is new as arrivals, right from Home, and says so', async () => {
      setupLists([two('a', 'Alpha')])
      const items = found(2).newItems
      vi.mocked(api.checkForUpdates).mockResolvedValue({ ...found(2), newItems: items })
      vi.mocked(api.importItems).mockResolvedValue([])
      const { pending } = await pendingWith({ a: 2 })
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())
      vi.mocked(api.lists).mockClear()

      act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Update List' }).click())

      await waitFor(() => expect(bands()).toHaveLength(0))
      expect(api.importItems).toHaveBeenCalledWith('a', items, 'import', true)
      expect(await screen.findAllByText('Added 2 new items to “Alpha”.')).not.toHaveLength(0)
      // The row gets its N NEW badge from a fresh read.
      await waitFor(() => expect(api.lists).toHaveBeenCalled())
    })

    it('says so, and adds nothing, when the source has nothing new any more', async () => {
      setupLists([two('a', 'Alpha')])
      vi.mocked(api.checkForUpdates).mockResolvedValue(found(0))
      const { pending } = await pendingWith({ a: 2 })
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())

      act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Update List' }).click())

      expect(await screen.findAllByText('No new items upstream.')).not.toHaveLength(0)
      expect(api.importItems).not.toHaveBeenCalled()
      expect(bands()).toHaveLength(0)
    })

    it('keeps the band and says why when the update fails', async () => {
      setupLists([two('a', 'Alpha')])
      vi.mocked(api.checkForUpdates).mockRejectedValue(new Error('Source is down'))
      const { pending } = await pendingWith({ a: 2 })
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())

      act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Update List' }).click())

      expect(await screen.findAllByText('Source is down')).not.toHaveLength(0)
      expect(bandFor('Alpha')).toBeDefined()
    })

    it('cannot be pressed twice while it works', async () => {
      setupLists([two('a', 'Alpha')])
      let release!: () => void
      vi.mocked(api.checkForUpdates).mockReturnValue(new Promise((resolve) => (release = () => resolve(found(0)))))
      const { pending } = await pendingWith({ a: 2 })
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())

      act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Update List' }).click())
      const again = within(bandFor('Alpha')!).getByRole('button', { name: /Update List|Updating/ }) as HTMLButtonElement

      expect(again.disabled).toBe(true)
      await act(async () => release())
    })
  })

  describe('the Check for updates button', () => {
    const press = () => act(() => screen.getByRole('button', { name: 'Check for updates' }).click())

    it('checks every list that has a source, and no other', async () => {
      setupLists([two('a', 'Alpha'), list({ id: 'b', title: 'Bravo', externalRef: null }), two('c', 'Charlie')])
      vi.mocked(api.checkForUpdates).mockResolvedValue(found(0))
      const { pending } = await pendingWith()
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())

      press()

      await waitFor(() => expect(api.checkForUpdates).toHaveBeenCalledTimes(2))
      expect(vi.mocked(api.checkForUpdates).mock.calls).toEqual([['a', false], ['c', false]])
    })

    it('shows each band as its list is answered, while the others are still being looked at', async () => {
      setupLists([two('a', 'Alpha'), two('b', 'Bravo')])
      let releaseSecond!: () => void
      vi.mocked(api.checkForUpdates)
        .mockResolvedValueOnce(found(2))
        .mockReturnValueOnce(new Promise((resolve) => (releaseSecond = () => resolve(found(1)))))
      const { pending } = await pendingWith()
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())

      press()

      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())
      expect(bandFor('Bravo')).toBeUndefined()
      expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(true)
      expect(document.querySelector('.q-home-actions .q-spin')).not.toBeNull()

      await act(async () => releaseSecond())
      await waitFor(() => expect(bandFor('Bravo')).toBeDefined())
      expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('answers "No new items upstream." when there is nothing anywhere', async () => {
      setupLists([two('a', 'Alpha')])
      vi.mocked(api.checkForUpdates).mockResolvedValue(found(0))
      const { pending } = await pendingWith()
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())

      press()

      expect(await screen.findAllByText('No new items upstream.')).not.toHaveLength(0)
    })

    it('brings back an update that was dismissed: an explicit check shows everything available', async () => {
      setupLists([two('a', 'Alpha')])
      vi.mocked(api.checkForUpdates).mockResolvedValue(found(2))
      const { pending } = await pendingWith()
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())
      press()
      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())
      act(() => within(bandFor('Alpha')!).getByRole('button', { name: 'Dismiss' }).click())
      await waitFor(() => expect(bands()).toHaveLength(0))

      press()

      await waitFor(() => expect(bandFor('Alpha')).toBeDefined())
    })

    it('reports the lists it could not reach, once, and still shows what it found', async () => {
      setupLists([two('a', 'Alpha'), two('b', 'Bravo'), two('c', 'Charlie')])
      vi.mocked(api.checkForUpdates)
        .mockResolvedValueOnce(found(1))
        .mockRejectedValueOnce(new Error('Source is down'))
        .mockResolvedValueOnce(found(3))
      const { pending } = await pendingWith()
      renderHome(vi.fn(), pending)
      await waitFor(() => expect(screen.getByText('Alpha')).not.toBeNull())

      press()

      expect(await screen.findAllByText('Could not check 1 list: Bravo')).not.toHaveLength(0)
      expect(bandFor('Alpha')).toBeDefined()
      expect(bandFor('Charlie')).toBeDefined()
    })
  })
})
