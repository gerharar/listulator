// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { subscribeListsChanged } from '../../lib/listsChanged.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'
import { en } from '../../locale/en.js'

/** The band on a sample list (H-018, 33.8): Remove Sample and Keep It, only on a list that is a sample. */

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async () => undefined, set: async () => {} }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), updateList: vi.fn(), deleteList: vi.fn(), restoreList: vi.fn() },
}))

const TYPES: MediaType[] = [{ key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true }]

const item = (id: string, orderIndex: number): ListItem => ({
  id,
  listId: 'L1',
  title: id.toUpperCase(),
  orderIndex,
  timeToConsumeMinutes: 120,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: null,
  group: null,
  tags: null,
  notes: null,
  yearUnk: 0,
  isNew: false,
})

function list(over: Partial<MediaListDetail> = {}): MediaListDetail {
  return {
    id: 'L1',
    title: 'Marvel Cinematic Universe',
    description: null,
    mediaType: 'movie',
    source: 'canonical',
    externalRef: 'canonical:lists/mega/mcu-extended.yaml',
    status: null,
    isSample: true,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: [item('a', 0), item('b', 1)],
    groups: [],
    ...over,
  } as MediaListDetail
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

beforeEach(() => {
  vi.mocked(api.updateList).mockResolvedValue({} as never)
})

async function open(detail: MediaListDetail = list(), onLeave = vi.fn()) {
  vi.mocked(api.list).mockResolvedValue(detail)
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} onLeave={onLeave} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText(detail.title, { selector: 'h1' })
  await act(async () => {})

  return { onLeave }
}

const band = () => document.querySelector('.q-sample-band')

describe('the sample band', () => {
  it('shows the sentence of the design with Remove Sample and Keep It, under the toolbar and above the rows', async () => {
    await open()

    expect(band()!.textContent).toContain(en.quantum.list.sample.text)
    expect(screen.getByRole('button', { name: en.quantum.list.sample.remove })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep It' })).toBeTruthy()
    const toolbar = document.querySelector('.q-filterbar')!
    const rows = document.querySelector('.q-list-cols')!
    expect(toolbar.compareDocumentPosition(band()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(band()!.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is absent on every other list', async () => {
    await open(list({ isSample: false }))

    expect(band()).toBeNull()
  })

  it('Keep It clears the mark, removes the band, says so, and does not leave the list', async () => {
    const { onLeave } = await open()

    fireEvent.click(screen.getByRole('button', { name: 'Keep It' }))

    await waitFor(() => expect(band()).toBeNull())
    expect(api.updateList).toHaveBeenCalledWith('L1', { isSample: false })
    expect((await screen.findAllByText('Kept “Marvel Cinematic Universe” as your own list')).length).toBeGreaterThan(0)
    expect(onLeave).not.toHaveBeenCalled()
    expect(api.deleteList).not.toHaveBeenCalled()
  })

  it('keeps the band and says why when Keep It fails', async () => {
    vi.mocked(api.updateList).mockRejectedValue(new Error('offline'))
    await open()

    fireEvent.click(screen.getByRole('button', { name: 'Keep It' }))

    // The toast and the live region both say it.
    expect((await screen.findAllByText('The list could not be kept. Try again')).length).toBeGreaterThan(0)
    expect(band()).not.toBeNull()
  })

  it('Remove Sample deletes the list, leaves it, and offers Undo', async () => {
    const restore = { list: { id: 'L1' } } as never
    vi.mocked(api.deleteList).mockResolvedValue(restore)
    const { onLeave } = await open()

    fireEvent.click(screen.getByRole('button', { name: en.quantum.list.sample.remove }))

    await waitFor(() => expect(onLeave).toHaveBeenCalled())
    expect(api.deleteList).toHaveBeenCalledWith('L1')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('Undo of Remove Sample puts the list back, as it was (still a sample), and tells the app a list is back', async () => {
    const restore = { list: { id: 'L1', isSample: true } } as never
    vi.mocked(api.deleteList).mockResolvedValue(restore)
    vi.mocked(api.restoreList).mockResolvedValue({} as never)
    const heard = vi.fn()
    const stop = subscribeListsChanged(heard)
    await open()
    fireEvent.click(screen.getByRole('button', { name: en.quantum.list.sample.remove }))

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(api.restoreList).toHaveBeenCalledWith(restore))
    expect(heard).toHaveBeenCalled()
    stop()
  })
})
