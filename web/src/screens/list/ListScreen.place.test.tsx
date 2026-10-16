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
 * Where a long list scrolls to, and that the rows follow it at once (Phase 25.4): a jump, a row that was added, a group folded or opened,
 * Collapse / Expand all, a filter. jsdom has no layout, so the scroller's height is stubbed. Setting `scrollTop` from code sends no scroll
 * event here, so a row that is drawn after such a move was drawn by the screen itself and not by a later scroll event: that is the "no
 * flash of the wrong rows" the slice promises. The numbers are the model's: a group of 100 is 47 + 100 x 46 = 4,647px.
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
  api: { list: vi.fn(), setConsumed: vi.fn(), itemSource: vi.fn(), restoreOrder: vi.fn(), addItem: vi.fn() },
}))

const TYPES: MediaType[] = [{ key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true }]

const GROUP = 47 + 100 * 46
const name = (k: number) => `Group ${String(k).padStart(2, '0')}`

/** 50 groups of 100 items: `Film 0` to `Film 4999`, ids `i0`..`i4999`, groups `g0`..`g49`; the first `done` items are done. */
function detail(extra: ListItem[] = [], done = 0): MediaListDetail {
  const items = Array.from({ length: 5000 }, (_, index) => ({
    id: `i${index}`,
    listId: 'L1',
    title: `Film ${index}`,
    orderIndex: index,
    timeToConsumeMinutes: 90,
    timeToConsumeIsEstimated: false,
    consumedAt: index < done ? '2026-01-01T00:00:00Z' : null,
    source: 'manual',
    year: null,
    group: name(Math.floor(index / 100)),
    tags: null,
    notes: null,
    yearUnk: 0,
    isNew: false,
  })) as ListItem[]

  return {
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
    items: [...items, ...extra],
    groups: Array.from({ length: 50 }, (_, k) => ({ id: `g${k}`, listId: 'L1', name: name(k), orderIndex: k }) as ListGroup),
  } as MediaListDetail
}

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

async function open(done = 0) {
  vi.mocked(api.list).mockResolvedValue(detail([], done))
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

const body = () => document.querySelector('.q-list-body') as HTMLElement
const row = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const drawn = (title: string) => screen.queryByText(title) !== null

/** The reader scrolls: the position is set and announced, as a browser does. */
async function scrollRows(top: number) {
  Object.defineProperty(body(), 'scrollTop', { value: top, configurable: true, writable: true })
  await act(async () => {
    body().dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
}

const railEntry = (k: number) =>
  Array.from(document.querySelectorAll<HTMLElement>('.q-rail button')).find((button) => button.textContent?.startsWith(name(k)))!

describe('the jump rail scrolls to a group, from the model (25.4)', () => {
  it('puts the header of a group far below at the top, with its rows drawn', async () => {
    await open()

    await act(async () => {
      fireEvent.click(railEntry(30))
    })

    expect(body().scrollTop).toBe(30 * GROUP)
    expect(row('g30')).not.toBeNull()
    expect(drawn('Film 3000')).toBe(true)
    expect(drawn('Film 0')).toBe(false)
  })

  it('opens a shut group first, then scrolls to it', async () => {
    prefs.set('list:L1:collapsed', JSON.stringify([name(30)]))
    await open()
    expect(drawn('Film 3000')).toBe(false)

    await act(async () => {
      fireEvent.click(railEntry(30))
    })

    expect(body().scrollTop).toBe(30 * GROUP)
    expect(drawn('Film 3000')).toBe(true)
  })
})

describe('folding keeps the reader where they were (25.4)', () => {
  it('folding the group the reader is deep inside leaves its header at the top of the view', async () => {
    await open()
    await scrollRows(3 * GROUP + 47 + 50 * 46)
    expect(row('g3')).not.toBeNull()

    await act(async () => {
      fireEvent.click(row('g3')!)
    })

    expect(body().scrollTop).toBe(3 * GROUP)
    expect(row('g3')).not.toBeNull()
    expect(drawn('Film 400')).toBe(true)
  })

  it('Collapse all and Expand all bring the reader back to the group they were in, and the window follows', async () => {
    await open()
    await scrollRows(3 * GROUP + 47 + 50 * 46)
    const fold = document.querySelector('.q-fold') as HTMLElement

    await act(async () => {
      fireEvent.click(fold)
    })
    // Fifty shut groups are 50 rows: drawn whole.
    expect(body().scrollTop).toBe(3 * 47)
    expect(row('g3')).not.toBeNull()
    expect(row('g49')).not.toBeNull()

    await act(async () => {
      fireEvent.click(fold)
    })
    expect(body().scrollTop).toBe(3 * GROUP)
    expect(row('g3')).not.toBeNull()
    expect(drawn('Film 300')).toBe(true)
    expect(row('g49')).toBeNull()
  })
})

describe('a filter keeps the reader in the list that is left (25.4)', () => {
  it('moves to the next row that is left, and back to where the reader was when the filter goes', async () => {
    await open()
    await scrollRows(3 * GROUP + 47 + 50 * 46)
    const field = screen.getByLabelText('Filter items')

    await act(async () => {
      fireEvent.change(field, { target: { value: 'Film 4999' } })
    })
    expect(body().scrollTop).toBe(0)
    expect(drawn('Film 4999')).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    })
    expect(body().scrollTop).toBe(49 * GROUP)
    expect(row('g49')).not.toBeNull()
    expect(drawn('Film 4900')).toBe(true)
  })
})

describe('Hide Completed keeps the reader in the list that is left (25.4)', () => {
  it('the groups that are all done go, and the reader keeps the rows they were reading', async () => {
    await open(1000)
    await scrollRows(12 * GROUP + 47 + 50 * 46)
    expect(drawn('Film 1250')).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Hide Completed/ }))
    })

    // Groups 0 to 9 (all done) are gone: ten blocks above the reader.
    expect(row('g0')).toBeNull()
    expect(body().scrollTop).toBe(2 * GROUP + 47 + 50 * 46)
    expect(drawn('Film 1250')).toBe(true)
    expect(row('g12')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Hide Completed|Show done items again/ }))
    })

    expect(body().scrollTop).toBe(12 * GROUP + 47 + 50 * 46)
    expect(drawn('Film 1250')).toBe(true)
  })
})

describe('carrying a block keeps it where it is on the screen (25.5)', () => {
  const pointer = (type: 'pointermove' | 'pointerup', x: number, y: number) =>
    act(async () => void window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })))

  it('a group picked up stays where it is while every group shuts, and is in view when they open again', async () => {
    vi.mocked(api.restoreOrder).mockResolvedValue(undefined as never)
    // jsdom has no hit testing: nothing is under the pointer until the drop below.
    document.elementFromPoint = () => null
    await open()
    // Group 20's header is 100px below the top of the view.
    await scrollRows(20 * GROUP - 100)
    expect(row('g20')).not.toBeNull()

    fireEvent.pointerDown(row('g20')!.querySelector('.q-handle') as HTMLElement, { button: 0, clientX: 10, clientY: 300 })
    await pointer('pointermove', 10, 330)

    // Fifty shut groups are fifty headers: the carried one is 100px below the top of the view still, not wherever the old position lands.
    expect(document.querySelectorAll('.q-item')).toHaveLength(0)
    expect(row('g20')).not.toBeNull()
    expect(body().scrollTop).toBe(20 * 47 - 100)

    // Dropped after Group 45: the groups open, and the dropped group (now the 46th) has its header at the drop line, which was Group 45's
    // bottom: (45 x 47 + 47) - 840 = 1,322px below the top of the view.
    const target = row('g45')!
    target.getBoundingClientRect = () => ({ top: 100, height: 47, bottom: 147, left: 0, right: 400, width: 400, x: 0, y: 100, toJSON: () => ({}) })
    document.elementFromPoint = () => target
    await pointer('pointerup', 10, 140)

    expect(body().scrollTop).toBe(45 * GROUP - 1322)
    expect(row('g20')).not.toBeNull()
  })
})

describe('a carried block that is let go of without dropping (25.5)', () => {
  it('Escape puts the view back where it was: the groups open and the carried group has not moved on the screen', async () => {
    document.elementFromPoint = () => null
    await open()
    await scrollRows(20 * GROUP - 100)
    fireEvent.pointerDown(row('g20')!.querySelector('.q-handle') as HTMLElement, { button: 0, clientX: 10, clientY: 300 })
    await act(async () => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 330, bubbles: true, cancelable: true })))
    expect(body().scrollTop).toBe(20 * 47 - 100)

    await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))

    expect(body().scrollTop).toBe(20 * GROUP - 100)
    expect(row('g20')).not.toBeNull()
    expect(drawn('Film 2000')).toBe(true)
  })
})

describe('a row that was added is scrolled to (25.4)', () => {
  it('brings an item added to a far group into view, drawn and pulsing', async () => {
    await open()
    const added = { ...detail().items[0]!, id: 'n', title: 'Newcomer', orderIndex: 9000, group: name(40) } as ListItem
    vi.mocked(api.addItem).mockResolvedValue(added)

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Newcomer' } })
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: name(40) } })
    vi.mocked(api.list).mockResolvedValue(detail([added]))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })
    await screen.findByText('Newcomer')

    const top = 40 * GROUP + 47 + 100 * 46
    expect(Math.abs(body().scrollTop - (top - 47 - (460 - 47 - 46) / 2))).toBeLessThanOrEqual(1)
    expect(row('n')!.className).toContain('pulse')
  })
})
