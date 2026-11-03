// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { en } from '../../locale/en.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/** The box on a group head of a very long group (H-026, 46.4): one call for every item, whatever the window draws. */

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async () => undefined, set: async () => {} }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), setConsumed: vi.fn(), setConsumedMany: vi.fn(), restoreConsumed: vi.fn(), itemSource: vi.fn(), restoreOrder: vi.fn() },
}))

const TYPES: MediaType[] = [{ key: 'tv', label: 'TV Shows', sortOrder: 1, defaultDurationMinutes: 30, searchAvailable: true, previewable: true }]

const COUNT = 5000

const detail = (): MediaListDetail =>
  ({
    id: 'L1',
    title: 'Long Show',
    description: null,
    mediaType: 'tv',
    source: 'manual',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    // Every tenth episode is done already.
    items: Array.from({ length: COUNT }, (_, index) => ({
      id: `i${index}`,
      listId: 'L1',
      title: `Episode ${index}`,
      orderIndex: index,
      timeToConsumeMinutes: 30,
      timeToConsumeIsEstimated: false,
      consumedAt: index % 10 === 0 ? '2026-01-01T00:00:00.000Z' : null,
      source: 'manual',
      year: null,
      group: 'Season 1',
      tags: null,
      notes: null,
      yearUnk: 0,
      isNew: false,
    })) as ListItem[],
    groups: [{ id: 'g1', listId: 'L1', name: 'Season 1', orderIndex: 0 } as ListGroup],
  }) as MediaListDetail

beforeEach(() => {
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(460)
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(COUNT * 46)
  vi.mocked(api.list).mockResolvedValue(detail())
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

describe('a group of 5,000 items', () => {
  it('is marked with one call that carries every id, and the box, the progress and the drawn rows follow', async () => {
    vi.mocked(api.setConsumedMany).mockResolvedValue({ restore: { items: [] } })
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <OverlayManagerProvider>
            <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
          </OverlayManagerProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )
    await waitFor(() => expect(document.querySelector('[data-row-id="g1"]')).not.toBeNull())
    await act(async () => {})
    const head = () => document.querySelector<HTMLElement>('[data-row-id="g1"]')!
    const box = () => head().querySelector<HTMLElement>('[role="checkbox"]')!
    expect(box().getAttribute('aria-checked')).toBe('mixed')

    fireEvent.click(box())

    expect(api.setConsumedMany).toHaveBeenCalledTimes(1)
    const [listId, ids, done] = vi.mocked(api.setConsumedMany).mock.calls[0]!
    expect([listId, done, ids.length]).toEqual(['L1', true, COUNT])
    expect(ids[0]).toBe('i0')
    expect(ids[COUNT - 1]).toBe(`i${COUNT - 1}`)
    expect(api.setConsumed).not.toHaveBeenCalled()
    expect(box().getAttribute('aria-checked')).toBe('true')
    expect(head().textContent).toContain(`${COUNT}/${COUNT}`)
    // Whatever rows the window draws are ticked.
    const drawn = Array.from(document.querySelectorAll<HTMLElement>('.q-item [role="checkbox"]'))
    expect(drawn.length).toBeGreaterThan(0)
    expect(drawn.every((entry) => entry.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(box().getAttribute('aria-label')).toBe(en.quantum.list.itemActions.groupBoxUnmark('Season 1', COUNT, false))
  })
})
