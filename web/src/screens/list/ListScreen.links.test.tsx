// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/**
 * H-002 (IGDB): a link that needs a page slug is looked up in the background; the screen reads the list again every
 * few seconds while any is on its way, takes only the links that arrived, and stops once none is pending.
 */

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async () => undefined, set: async () => undefined }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true },
]

const game = (n: number, state: 'pending' | 'linked' | 'none'): ListItem => ({
  id: `g${n}`,
  listId: 'L1',
  title: `Game ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: 600,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: null,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
  link: state === 'linked' ? { url: `https://www.igdb.com/games/game-${n}`, source: 'IGDB' } : null,
  ...(state === 'pending' ? { linkPending: true } : {}),
})

const detail = (items: ListItem[]): MediaListDetail =>
  ({ id: 'L1', title: 'Zelda', description: null, mediaType: 'movie', source: 'api', externalRef: null, status: null, createdAt: '', updatedAt: '', stats: {} as never, items, groups: [] }) as MediaListDetail

function Harness() {
  return (
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

async function open() {
  render(<Harness />)
  await screen.findByText('Zelda')
  await act(async () => {})
}

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

const links = () => screen.queryAllByRole('link').map((link) => link.getAttribute('href'))

describe('a list whose links are still being looked up (H-002, IGDB)', () => {
  it('shows no ↗ yet, then each as it arrives, and stops reading the list once none is pending', async () => {
    vi.mocked(api.list)
      .mockResolvedValueOnce(detail([game(1, 'pending'), game(2, 'pending')]))
      .mockResolvedValueOnce(detail([game(1, 'linked'), game(2, 'pending')]))
      .mockResolvedValue(detail([game(1, 'linked'), game(2, 'linked')]))
    await open()
    expect(links()).toEqual([])

    await advance(3000)
    expect(links()).toEqual(['https://www.igdb.com/games/game-1'])

    await advance(3000)
    expect(links()).toEqual(['https://www.igdb.com/games/game-1', 'https://www.igdb.com/games/game-2'])
    expect(api.list).toHaveBeenCalledTimes(3)

    await advance(30_000)
    expect(api.list).toHaveBeenCalledTimes(3)
  })

  it('stops reading the list when the lookup gives up, and shows no ↗ for what it could not find', async () => {
    vi.mocked(api.list)
      .mockResolvedValueOnce(detail([game(1, 'pending')]))
      .mockResolvedValue(detail([game(1, 'none')]))
    await open()

    await advance(3000)
    await advance(30_000)

    expect(links()).toEqual([])
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('does not read the list again by itself when no link is pending', async () => {
    vi.mocked(api.list).mockResolvedValue(detail([game(1, 'linked'), game(2, 'none')]))
    await open()

    await advance(30_000)

    expect(api.list).toHaveBeenCalledTimes(1)
  })
})
