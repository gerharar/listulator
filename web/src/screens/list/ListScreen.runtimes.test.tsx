// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/**
 * Task 15.7: a list built from a listing shows "-" for a length still being looked up, the time left as
 * approximate, and fills in as the lengths arrive: the screen reads the list again every few seconds while
 * anything is pending.
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

const film = (n: number, minutes: number, pending: boolean): ListItem => ({
  id: `f${n}`,
  listId: 'L1',
  title: `Film ${n}`,
  orderIndex: n,
  timeToConsumeMinutes: minutes,
  timeToConsumeIsEstimated: pending,
  consumedAt: null,
  source: 'import',
  year: null,
  group: null,
  tags: null,
  notes: null,
  isNew: false,
  runtimePending: pending,
})

const detail = (items: ListItem[]): MediaListDetail =>
  ({ id: 'L1', title: 'Pixar', description: null, mediaType: 'movie', source: 'api', externalRef: null, status: null, createdAt: '', updatedAt: '', stats: {} as never, items, groups: [] }) as MediaListDetail

const justBuilt = () => detail([film(1, 120, true), film(2, 120, true), film(3, 120, true)])
const partway = () => detail([film(1, 101, false), film(2, 120, true), film(3, 120, true)])
const finished = () => detail([film(1, 101, false), film(2, 102, false), film(3, 103, false)])

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
  // Only the interval: the rest of the timers stay real, so the screen's own waiting still works.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

async function open() {
  render(<Harness />)
  await screen.findByText('Pixar')
  await act(async () => {})
}

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

const rowTime = (title: string) => within(screen.getByText(title).closest('[data-row-id]') as HTMLElement).getByText(/^(-|\d+h( \d+m)?|\d+m)$/).textContent

describe('a list whose lengths are still being looked up (15.7)', () => {
  it('shows "-" for what is still coming and the time left as approximate', async () => {
    vi.mocked(api.list).mockResolvedValue(justBuilt())

    await open()

    expect(['Film 1', 'Film 2', 'Film 3'].map(rowTime)).toEqual(['-', '-', '-'])
    expect(screen.getByText('≈ 6h left')).toBeTruthy()
  })

  it('fills in as the lengths arrive, and stops reading the list once nothing is pending', async () => {
    vi.mocked(api.list).mockResolvedValueOnce(justBuilt()).mockResolvedValueOnce(partway()).mockResolvedValue(finished())
    await open()
    expect(api.list).toHaveBeenCalledTimes(1)

    await advance(3000)
    expect(['Film 1', 'Film 2', 'Film 3'].map(rowTime)).toEqual(['1h 41m', '-', '-'])

    await advance(3000)
    expect(['Film 1', 'Film 2', 'Film 3'].map(rowTime)).toEqual(['1h 41m', '1h 42m', '1h 43m'])
    expect(screen.getByText('5h 6m left')).toBeTruthy()
    expect(api.list).toHaveBeenCalledTimes(3)

    await advance(30_000)
    expect(api.list).toHaveBeenCalledTimes(3)
  })

  it('does not read the list again by itself when nothing is pending', async () => {
    vi.mocked(api.list).mockResolvedValue(finished())

    await open()
    await advance(30_000)

    expect(api.list).toHaveBeenCalledTimes(1)
  })

  it('keeps showing what it has when a re-read fails, and tries again', async () => {
    vi.mocked(api.list).mockResolvedValueOnce(justBuilt()).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(finished())
    await open()

    await advance(3000)
    expect(rowTime('Film 1')).toBe('-')

    await advance(3000)
    expect(rowTime('Film 1')).toBe('1h 41m')
  })
})
