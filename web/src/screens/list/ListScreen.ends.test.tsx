// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/**
 * The split Up / Down button in the toolbar (H-019, 32.4): shown on a list taller than two screens, a half disabled at its end, and each half
 * takes the reader to that end like Home and End do. jsdom has no layout: the scroller's heights are stubbed and its position set by hand.
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
  // A list opens at the row it remembers, so its first rows need not be there: wait for any row.
  await waitFor(() => expect(document.querySelector('[data-row-id]')).not.toBeNull())
  await act(async () => {})
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const active = () => (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row-id]')?.dataset['rowId']

const FULL_HEIGHT = 5000 * 46

beforeEach(() => {
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(FULL_HEIGHT)
})

const group = () => screen.queryByRole('group', { name: 'Jump to an end of the list' })
const up = () => screen.getByRole('button', { name: 'Scroll to the top of the list' }) as HTMLButtonElement
const down = () => screen.getByRole('button', { name: 'Scroll to the bottom of the list' }) as HTMLButtonElement

async function scrollTo(top: number) {
  const body = document.querySelector('.q-list-body') as HTMLElement
  Object.defineProperty(body, 'scrollTop', { value: top, configurable: true, writable: true })
  await act(async () => {
    body.dispatchEvent(new Event('scroll'))
  })
}

describe('the split Up / Down button (32.4)', () => {
  it('is the last thing in the toolbar of a list taller than two screens, after Hide Completed on a list with one group', async () => {
    await open(5000)

    expect(group()).not.toBeNull()
    const bar = document.querySelector('.q-filterbar')!
    expect(bar.lastElementChild).toBe(group())
    expect(group()!.previousElementSibling!.classList.contains('q-hide-done')).toBe(true)
  })

  it('is not there on a short list', async () => {
    await open(10)

    expect(group()).toBeNull()
  })

  it('has its Up half disabled at the top, and both halves live in between', async () => {
    await open(5000)
    expect(up().disabled).toBe(true)
    expect(down().disabled).toBe(false)

    await scrollTo(2000 * 46)

    expect(up().disabled).toBe(false)
    expect(down().disabled).toBe(false)
  })

  it('has its Down half disabled at the bottom', async () => {
    await open(5000)

    await scrollTo(FULL_HEIGHT - 460)

    expect(up().disabled).toBe(false)
    expect(down().disabled).toBe(true)
  })

  it('Down goes to the last row: scrolled to the bottom, drawn, with focus, and says so', async () => {
    await open(5000)
    const body = document.querySelector('.q-list-body') as HTMLElement
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true, writable: true })

    await act(async () => {
      fireEvent.click(down())
    })

    expect(body.scrollTop).toBe(FULL_HEIGHT)
    expect(row('i4999')).not.toBeNull()
    expect(active()).toBe('i4999')
    await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Bottom of the list'))
    await scrollTo(FULL_HEIGHT - 460)
    expect(down().disabled).toBe(true)
  })

  it('Up goes back to the first row from far away', async () => {
    prefs.set('list:L1:focus', 'i3000')
    await open(5000)
    await scrollTo(3000 * 46)

    await act(async () => {
      fireEvent.click(up())
    })

    expect(active()).toBe('g1')
    await waitFor(() => expect(document.querySelector('.q-live')!.textContent).toBe('Top of the list'))
    await scrollTo(0)
    expect(up().disabled).toBe(true)
  })
})
