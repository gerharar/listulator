// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/**
 * Keyboard and focus on a list that draws a window of its rows (Phase 25.3): the arrow keys, Shift+arrow moves and the tab stop reach rows that are not drawn. jsdom has no layout, so the scroller's height is stubbed and its position set by hand, and focus does not scroll (the focus is what is asserted).
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

async function scrollRows(top: number) {
  const body = document.querySelector('.q-list-body') as HTMLElement
  Object.defineProperty(body, 'scrollTop', { value: top, configurable: true, writable: true })
  await act(async () => {
    body.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
}

async function press(target: HTMLElement, key: string, shiftKey = false) {
  await act(async () => {
    fireEvent.keyDown(target, { key, shiftKey })
  })
}

describe('keyboard and focus across rows that are not drawn (25.3)', () => {
  it('keeps the tab stop drawn when nothing was focused yet, however far the window has moved', async () => {
    await open(5000)
    // The list starts with the group, so its header is the first row and the tab stop.
    expect(row('g1')!.tabIndex).toBe(0)

    await scrollRows(4000 * 46)

    expect(row('i4000')).not.toBeNull()
    expect(row('g1')).not.toBeNull()
    expect(row('g1')!.tabIndex).toBe(0)
  })

  it('↓ from a row whose neighbour is not drawn brings the neighbour and focuses it', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    await scrollRows(4000 * 46)
    expect(row('i11')).toBeNull()
    row('i10')!.focus()

    await press(row('i10')!, 'ArrowDown')

    expect(active()).toBe('i11')
  })

  it('↑ works the same way', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    await scrollRows(4000 * 46)
    expect(row('i9')).toBeNull()
    row('i10')!.focus()

    await press(row('i10')!, 'ArrowUp')

    expect(active()).toBe('i9')
  })

  it('walking with ↓ well past the drawn window never drops focus (the e2e walks to row 3,000)', async () => {
    await open(5000)
    row('i0')!.focus()

    for (let step = 1; step <= 300; step += 1) {
      await press(row(active()!)!, 'ArrowDown')
      if (active() !== `i${step}`) throw new Error(`focus was lost at step ${step}: ${active()}`)
    }

    expect(active()).toBe('i300')
  }, 30_000)

  it('↓ at the last row stays where it is', async () => {
    prefs.set('list:L1:focus', 'i4999')
    await open(5000)
    await scrollRows(4999 * 46)
    row('i4999')!.focus()

    await press(row('i4999')!, 'ArrowDown')

    expect(active()).toBe('i4999')
  })

  it('Shift+↓ moves the focused row and leaves focus and the view on it', async () => {
    vi.mocked(api.restoreOrder).mockResolvedValue(undefined as never)
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    prefs.set('list:L1:focus', 'i3000')
    await open(5000)
    await scrollRows(3000 * 46)
    row('i3000')!.focus()

    await press(row('i3000')!, 'ArrowDown', true)

    expect(active()).toBe('i3000')
    expect(scrolled).toHaveBeenCalled()
    expect(scrolled.mock.contexts.at(-1)).toBe(row('i3000'))
  })

  it('a list that is reopened scrolls to the row it remembers', async () => {
    prefs.set('list:L1:focus', 'i3000')
    const set = vi.spyOn(Element.prototype, 'scrollTop', 'set')

    await open(5000)

    // Row 3,000: the group's header and its 2,500 members, then 500 loose rows.
    const offset = 47 + 2500 * 46 + 500 * 46
    const asked = set.mock.calls.map(([top]) => top as number).filter((top) => top > 0)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBeGreaterThan(offset - 460)
    expect(asked[0]).toBeLessThanOrEqual(offset)
  })

  it('a list that is opened with no remembered row is not scrolled', async () => {
    const set = vi.spyOn(Element.prototype, 'scrollTop', 'set')

    await open(5000)

    expect(set.mock.calls.filter(([top]) => (top as number) > 0)).toHaveLength(0)
  })

  it('a short list is reopened at the row it remembers too (owner, 2026-10-16: the same for every list)', async () => {
    prefs.set('list:L1:focus', 'i100')
    const set = vi.spyOn(Element.prototype, 'scrollTop', 'set')

    await open(150)

    // 75 rows in the group "First" (its header 47px), then 25 loose rows before row 100.
    const offset = 47 + 75 * 46 + 25 * 46
    const asked = set.mock.calls.map(([top]) => top as number).filter((top) => top > 0)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBeGreaterThan(offset - 460)
    expect(asked[0]).toBeLessThanOrEqual(offset)
    expect(document.querySelectorAll('.q-list-spacer')).toHaveLength(0)
  })

  it('the rows of a list that opens at a remembered row are the ones around it from the first frame, not the top ones', async () => {
    prefs.set('list:L1:focus', 'i3000')

    await open(5000)

    expect(row('i3000')).not.toBeNull()
    expect(row('i0')).toBeNull()
  })
})

describe('Home and End (32.3)', () => {
  const live = () => document.querySelector('.q-live')!.textContent
  const FULL_HEIGHT = 5000 * 46

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(FULL_HEIGHT)
  })

  it('End goes to the last row of a long list: the scroller is at the bottom, the row is drawn and has focus, and the live region says so', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    row('i10')!.focus()
    const body = document.querySelector('.q-list-body') as HTMLElement

    await press(row('i10')!, 'End')

    expect(body.scrollTop).toBe(FULL_HEIGHT)
    expect(row('i4999')).not.toBeNull()
    expect(active()).toBe('i4999')
    await waitFor(() => expect(live()).toBe('Bottom of the list'))
  })

  it('Home goes back to the first row, from far away', async () => {
    prefs.set('list:L1:focus', 'i3000')
    await open(5000)
    await scrollRows(3000 * 46)
    row('i3000')!.focus()
    const body = document.querySelector('.q-list-body') as HTMLElement

    await press(row('i3000')!, 'Home')

    expect(body.scrollTop).toBe(0)
    // The list starts with the group, so its header is the first row.
    expect(active()).toBe('g1')
    await waitFor(() => expect(live()).toBe('Top of the list'))
  })

  it('does not scroll again when it focuses the row: it has already put the list there', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    row('i10')!.focus()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')

    await press(row('i10')!, 'End')

    expect(focus.mock.contexts.at(-1)).toBe(row('i4999'))
    expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }])
  })

  it('works on a short list that is not drawn as a window', async () => {
    await open(20)
    row('g1')!.focus()

    await press(row('g1')!, 'End')
    expect(active()).toBe('i19')

    await press(row('i19')!, 'Home')
    expect(active()).toBe('g1')
  })

  it('makes the row it lands on the one the list remembers', async () => {
    prefs.set('list:L1:focus', 'i10')
    await open(5000)
    row('i10')!.focus()

    await press(row('i10')!, 'End')

    await waitFor(() => expect(prefs.get('list:L1:focus')).toBe('i4999'))
  })

  it('leaves Home and End alone in a text field inside a row, and with a modifier', async () => {
    await open(20)
    const header = row('g1')!
    const field = document.createElement('input')
    header.appendChild(field)
    field.focus()

    await press(field, 'End')
    expect(document.activeElement).toBe(field)
    expect(live() ?? '').toBe('')

    header.focus()
    await act(async () => {
      fireEvent.keyDown(header, { key: 'End', ctrlKey: true })
      fireEvent.keyDown(header, { key: 'End', shiftKey: true })
      fireEvent.keyDown(header, { key: 'End', metaKey: true })
    })
    expect(active()).toBe('g1')
    expect(live() ?? '').toBe('')
  })

  it('does nothing when focus is not on a row', async () => {
    await open(20)
    const body = document.querySelector('.q-list-body') as HTMLElement

    await press(body, 'End')

    expect(active()).toBeUndefined()
    expect(live() ?? '').toBe('')
  })
})
