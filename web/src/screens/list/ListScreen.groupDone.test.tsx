// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { en } from '../../locale/en.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/** The box on a group head that marks the shown items done or not done (H-026, task 46.2). */

const store = new Map<string, string>()

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: string) => void store.set(key, value),
  }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), setConsumed: vi.fn(), setConsumedMany: vi.fn(), restoreConsumed: vi.fn(), itemSource: vi.fn() },
}))

const TYPES: MediaType[] = [
  { key: 'tv', label: 'TV Shows', sortOrder: 1, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
]

const DONE_AT = '2026-01-02T03:04:05.006Z'

const item = (id: string, title: string, orderIndex: number, group: string | null, done = false): ListItem => ({
  id,
  listId: 'L1',
  title,
  orderIndex,
  timeToConsumeMinutes: 30,
  timeToConsumeIsEstimated: false,
  consumedAt: done ? DONE_AT : null,
  source: 'import',
  year: null,
  group,
  tags: null,
  notes: null,
  yearUnk: 0,
  isNew: false,
})

/** Season 1 (three open), Season 2 (one of two done), and one loose item. */
function list(): MediaListDetail {
  return {
    id: 'L1',
    title: 'Some Show',
    description: null,
    mediaType: 'tv',
    source: 'api',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: [
      item('a1', 'Pilot', 0, 'Season 1'),
      item('a2', 'Second', 1, 'Season 1'),
      item('a3', 'Third', 2, 'Season 1'),
      item('b1', 'Return', 3, 'Season 2', true),
      item('b2', 'Again', 4, 'Season 2'),
      item('x', 'Special', 5, null),
    ],
    groups: [
      { id: 'g1', listId: 'L1', name: 'Season 1', orderIndex: 0 } as ListGroup,
      { id: 'g2', listId: 'L1', name: 'Season 2', orderIndex: 1 } as ListGroup,
    ],
  } as MediaListDetail
}

beforeEach(() => {
  store.clear()
  vi.mocked(api.list).mockResolvedValue(list())
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
  vi.mocked(api.setConsumedMany).mockResolvedValue({ restore: { items: [] } })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function open() {
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <OverlayManagerProvider>
          <ListScreen
            listId="L1"
            mediaTypes={TYPES}
            pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })}
          />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText('Some Show', { selector: 'h1' })
  await act(async () => {})
}

const row = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement
const groupBox = (id: string) => within(row(id)).getByRole('checkbox')
const itemBox = (id: string) => within(row(id)).getByRole('checkbox')
const state = (id: string) => groupBox(id).getAttribute('aria-checked')

describe('the box on a group head', () => {
  it('reads empty, a dash or a tick from the items of its group, and a loose item has none', async () => {
    await open()

    expect(state('g1')).toBe('false')
    expect(state('g2')).toBe('mixed')
    expect(document.querySelectorAll('.q-group [role="checkbox"]')).toHaveLength(2)
    expect(within(row('x')).getAllByRole('checkbox')).toHaveLength(1)
  })

  it('marks every item of the group done with one call, and the rows, the box and the progress follow at once', async () => {
    await open()

    fireEvent.click(groupBox('g1'))

    expect(api.setConsumedMany).toHaveBeenCalledWith('L1', ['a1', 'a2', 'a3'], true)
    expect(api.setConsumed).not.toHaveBeenCalled()
    expect(state('g1')).toBe('true')
    for (const id of ['a1', 'a2', 'a3']) expect(itemBox(id).getAttribute('aria-checked')).toBe('true')
    expect(within(row('g1')).getByText('3/3')).toBeTruthy()
    // Other groups are not touched.
    expect(state('g2')).toBe('mixed')
    expect(itemBox('b2').getAttribute('aria-checked')).toBe('false')
  })

  it('from a dash it marks the rest done', async () => {
    await open()

    fireEvent.click(groupBox('g2'))

    expect(api.setConsumedMany).toHaveBeenCalledWith('L1', ['b1', 'b2'], true)
    expect(state('g2')).toBe('true')
  })

  it('from a tick it marks every item not done', async () => {
    await open()
    fireEvent.click(groupBox('g1'))
    vi.mocked(api.setConsumedMany).mockClear()

    fireEvent.click(groupBox('g1'))

    expect(api.setConsumedMany).toHaveBeenCalledWith('L1', ['a1', 'a2', 'a3'], false)
    expect(state('g1')).toBe('false')
    for (const id of ['a1', 'a2', 'a3']) expect(itemBox(id).getAttribute('aria-checked')).toBe('false')
  })

  it('does not fold or open the group', async () => {
    await open()
    expect(row('g1').getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(groupBox('g1'))
    fireEvent.keyDown(groupBox('g1'), { key: 'Enter' })
    fireEvent.keyDown(groupBox('g1'), { key: ' ' })

    expect(row('g1').getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-row-id="a1"]')).not.toBeNull()
  })

  it('works on a folded group, which stays folded', async () => {
    await open()
    fireEvent.click(within(row('g1')).getByText('Season 1'))
    expect(row('g1').getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-row-id="a1"]')).toBeNull()

    fireEvent.click(groupBox('g1'))

    expect(api.setConsumedMany).toHaveBeenCalledWith('L1', ['a1', 'a2', 'a3'], true)
    expect(state('g1')).toBe('true')
    expect(row('g1').getAttribute('aria-expanded')).toBe('false')
  })

  it('puts the items back, and says so, when the save fails (the one already done stays done)', async () => {
    await open()
    vi.mocked(api.setConsumedMany).mockRejectedValue(new Error('down'))

    fireEvent.click(groupBox('g2'))
    await waitFor(() => expect(screen.getByText(en.quantum.list.saveFailed)).toBeTruthy())

    expect(state('g2')).toBe('mixed')
    expect(itemBox('b1').getAttribute('aria-checked')).toBe('true')
    expect(itemBox('b2').getAttribute('aria-checked')).toBe('false')
  })
})
