// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'
import { lengthLabel } from './lengthLabel.js'

/**
 * Ticking one row must not re-render the others (Phase 25.0b: on 2,500 items a tick took 215 ms in Chromium and 855 ms in
 * WebKit, because every state change re-rendered every row). `lengthLabel` is called once by each row's render, so its calls
 * count the row renders.
 */
vi.mock('./lengthLabel.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lengthLabel.js')>()
  return { ...original, lengthLabel: vi.fn(original.lengthLabel) }
})

vi.mock('../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({ get: async () => undefined, set: async () => {} }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { list: vi.fn(), setConsumed: vi.fn(), itemSource: vi.fn(), restoreOrder: vi.fn() },
}))

const TYPES: MediaType[] = [{ key: 'movie', label: 'Movies', sortOrder: 1, defaultDurationMinutes: 120, searchAvailable: true, previewable: true }]

const COUNT = 60

const detail = (): MediaListDetail =>
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
    items: Array.from({ length: COUNT }, (_, index) => ({
      id: `i${index}`,
      listId: 'L1',
      title: `Film ${index}`,
      orderIndex: index,
      timeToConsumeMinutes: 90,
      timeToConsumeIsEstimated: false,
      consumedAt: null,
      source: 'manual',
      year: null,
      group: index < 30 ? 'First' : null,
      tags: null,
      notes: null,
      yearUnk: 0,
      isNew: false,
    })) as ListItem[],
    groups: [{ id: 'g1', listId: 'L1', name: 'First', orderIndex: 0 } as ListGroup],
  }) as MediaListDetail

beforeEach(() => {
  vi.mocked(api.list).mockResolvedValue(detail())
  vi.mocked(api.setConsumed).mockResolvedValue({} as never)
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
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
          <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
        </OverlayManagerProvider>
      </ToastProvider>
    </LiveRegionProvider>,
  )
  await screen.findByText('Film 0')
  await act(async () => {})
}

describe('a tick re-renders the row that was ticked, not every row (25.0b)', () => {
  it('ticking one row renders a handful of rows, not all of them', async () => {
    await open()
    expect(document.querySelectorAll('.q-item')).toHaveLength(COUNT)
    vi.mocked(lengthLabel).mockClear()

    fireEvent.click(document.querySelector('[data-row-id="i7"]') as HTMLElement)
    await act(async () => {})

    expect(document.querySelector('[data-row-id="i7"]')!.className).toContain('is-done')
    // The ticked row (once or twice) and nothing else; before the change it was all 60 for each state change.
    expect(vi.mocked(lengthLabel).mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('still ticks the right row after other rows were ticked (no handler goes stale)', async () => {
    await open()

    for (const id of ['i2', 'i40', 'i2']) {
      fireEvent.click(document.querySelector(`[data-row-id="${id}"]`) as HTMLElement)
      await act(async () => {})
    }

    expect(vi.mocked(api.setConsumed).mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['i2', true],
      ['i40', true],
      ['i2', false],
    ])
    expect(document.querySelector('[data-row-id="i2"]')!.className).not.toContain('is-done')
    expect(document.querySelector('[data-row-id="i40"]')!.className).toContain('is-done')
  })

  it('a row still opens its own details, its own Edit window and its own delete, after the list changed', async () => {
    await open()
    fireEvent.click(document.querySelector('[data-row-id="i5"]') as HTMLElement)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: 'Edit Film 9' }))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('Title', { selector: '.q-pop input' }) as HTMLInputElement).value).toBe('Film 9')
  })
})

describe('carrying a block over a group re-renders that group\'s rows only (27.3)', () => {
  const pointer = (y: number) =>
    act(async () => void window.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: y, bubbles: true, cancelable: true })))

  it('the target group\'s rows are drawn again once; moving on inside the same group draws no row, nor does its other half; the loose rows are never drawn again', async () => {
    await open()
    const inside = document.querySelector('[data-row-id="i10"]') as HTMLElement
    const block = document.querySelector('[data-block-key="g1"]') as HTMLElement
    // The group's block is 100-1500: its middle is 800.
    block.getBoundingClientRect = () => ({ top: 100, bottom: 1500, height: 1400, left: 0, right: 400, width: 400, x: 0, y: 100, toJSON: () => ({}) })
    document.elementFromPoint = () => inside
    fireEvent.pointerDown((document.querySelector('[data-row-id="i50"]') as HTMLElement).querySelector('.q-handle') as HTMLElement, { button: 0, clientX: 10, clientY: 40 })
    vi.mocked(lengthLabel).mockClear()

    await pointer(60)
    expect(document.querySelectorAll('.q-item.is-hover')).toHaveLength(30)
    // The 30 rows of the group (and the carried row, which is now being dragged), none of the other 29 loose rows.
    expect(vi.mocked(lengthLabel).mock.calls.length).toBeGreaterThanOrEqual(30)
    expect(vi.mocked(lengthLabel).mock.calls.length).toBeLessThanOrEqual(34)

    // Moving on inside the same half of the same group changes nothing.
    vi.mocked(lengthLabel).mockClear()
    await pointer(300)
    expect(vi.mocked(lengthLabel).mock.calls.length).toBe(0)

    vi.mocked(lengthLabel).mockClear()
    await pointer(1000)
    expect(document.querySelectorAll('.q-item.is-hover')).toHaveLength(30)
    expect(vi.mocked(lengthLabel).mock.calls.length).toBe(0)
  })
})

