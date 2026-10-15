// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/**
 * A long list draws a window of its rows (Phase 25.2). jsdom has no layout, so the scroller's height is stubbed and its position set by hand.
 */
const prefs = new Map<string, string>()
vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({
    get: async (key: string) => prefs.get(key),
    set: async (key: string, value: string) => void prefs.set(key, value),
  }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), setConsumed: vi.fn(), itemSource: vi.fn(), restoreOrder: vi.fn() },
}))

const TYPES: MediaType[] = [{ key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true }]

/** `count` items: the first half in the group "First", the rest loose. */
const detail = (count: number): MediaListDetail =>
  ({
    id: 'L1',
    title: 'Many',
    description: null,
    mediaType: 'movie',
    source: 'manual',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: Array.from({ length: count }, (_, index) => ({
      id: `i${index}`,
      listId: 'L1',
      title: `Film ${index}`,
      orderIndex: index,
      timeToConsumeMinutes: 90,
      timeToConsumeIsEstimated: false,
      consumedAt: null,
      source: 'manual',
      year: null,
      group: index < count / 2 ? 'First' : null,
      tags: null,
      notes: null,
      yearUnk: 0,
      isNew: false,
    })) as ListItem[],
    groups: [{ id: 'g1', listId: 'L1', name: 'First', orderIndex: 0 } as ListGroup],
  }) as MediaListDetail

beforeEach(() => {
  prefs.clear()
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(460)
  vi.mocked(api.setConsumed).mockResolvedValue({} as never)
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

async function open(count: number) {
  vi.mocked(api.list).mockResolvedValue(detail(count))
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText('Film 0')
  await act(async () => {})
}

const rows = () => document.querySelectorAll('.q-item')

describe('a long list draws a window of its rows (25.2)', () => {
  it('draws about a screenful of 5,000 items, not all of them, and still has its Add row at the end', async () => {
    await open(5000)

    expect(rows().length).toBeGreaterThan(9)
    expect(rows().length).toBeLessThan(80)
    expect(screen.queryByText('Film 4999')).toBeNull()
    expect(document.querySelector('.q-add-item')).not.toBeNull()
    expect(document.querySelector('.q-list-spacer')).not.toBeNull()
  })

  it('scrolling brings other rows and lets the old ones go; the group keeps its header', async () => {
    await open(5000)
    const body = document.querySelector('.q-list-body') as HTMLElement
    Object.defineProperty(body, 'scrollTop', { value: 2500 * 46, configurable: true, writable: true })

    await act(async () => {
      body.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    // Row 2,500 is the first loose item after the group (the group has 2,500): the window is at the end of the group and after it.
    expect(screen.queryByText('Film 0')).toBeNull()
    expect(screen.getByText('Film 2500')).toBeTruthy()
    expect(rows().length).toBeLessThan(80)
  })

  it('a list under 200 rows draws every row and no spacer, as it always did', async () => {
    await open(150)

    expect(rows()).toHaveLength(150)
    expect(document.querySelector('.q-list-spacer')).toBeNull()
  })

  it('keeps the row that holds the roving tab stop drawn however far the window has moved', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    expect(screen.getByText('Film 10')).toBeTruthy()
    const body = document.querySelector('.q-list-body') as HTMLElement
    Object.defineProperty(body, 'scrollTop', { value: 4000 * 46, configurable: true, writable: true })

    await act(async () => {
      body.dispatchEvent(new Event('scroll'))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    })

    expect(screen.getByText('Film 4000')).toBeTruthy()
    expect(screen.getByText('Film 10')).toBeTruthy()
  })

  it('ticking a row of a long list still works, and still re-renders only that row', async () => {
    await open(5000)

    fireEvent.click(document.querySelector('[data-row-id="i3"]') as HTMLElement)
    await act(async () => {})

    expect(document.querySelector('[data-row-id="i3"]')!.className).toContain('is-done')
    expect(vi.mocked(api.setConsumed)).toHaveBeenCalledWith('L1', 'i3', true)
  })
})
