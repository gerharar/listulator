// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'

/** The filter bar on the list screen (task 10.24): text, facets from the category's convention, fold-all. */

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
  api: { list: vi.fn(), restoreOrder: vi.fn(), setConsumed: vi.fn() },
}))

const TYPES: MediaType[] = [
  {
    key: 'game',
    label: 'Games',
    sortOrder: 1,
    defaultDurationMinutes: 600,
    searchAvailable: true,
    previewable: true,
    facets: [{ key: 'platform', label: 'Platform' }],
  },
  { key: 'tv', label: 'TV Shows', sortOrder: 2, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
]

const item = (id: string, title: string, orderIndex: number, group: string | null, tags: string[] | null): ListItem => ({
  id,
  listId: 'L1',
  title,
  orderIndex,
  timeToConsumeMinutes: 30,
  timeToConsumeIsEstimated: false,
  consumedAt: null,
  source: 'import',
  year: null,
  group,
  tags,
  notes: null,
  isNew: false,
})

/** Loose "Prologue", then Main (AC1 AC2 AC3), then Handhelds (Chronicles, Bloodlines). */
function list(mediaType = 'game'): MediaListDetail {
  return {
    id: 'L1',
    title: 'Assassin’s Creed',
    description: null,
    mediaType,
    source: 'api',
    externalRef: null,
    status: null,
    createdAt: '',
    updatedAt: '',
    stats: {} as never,
    items: [
      item('p', 'Prologue', 0, null, null),
      item('ac1', 'Assassin’s Creed', 1, 'Main', ['PS3', 'X360', 'PC']),
      item('ac2', 'Assassin’s Creed II', 2, 'Main', ['PS3', 'X360', 'PC']),
      item('ac3', 'Revelations', 3, 'Main', ['multi']),
      item('ch', 'Altaïr’s Chronicles', 4, 'Handhelds', ['NDS']),
      item('bl', 'Bloodlines', 5, 'Handhelds', ['PSP']),
    ],
    groups: [
      { id: 'gm', listId: 'L1', name: 'Main', orderIndex: 0 } as ListGroup,
      { id: 'gh', listId: 'L1', name: 'Handhelds', orderIndex: 1 } as ListGroup,
    ],
  } as MediaListDetail
}

beforeEach(() => {
  store.clear()
  vi.mocked(api.list).mockResolvedValue(list())
  vi.mocked(api.restoreOrder).mockResolvedValue(undefined)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function open(mediaType = 'game', tweak?: (detail: MediaListDetail) => void) {
  const detail = list(mediaType)
  tweak?.(detail)
  vi.mocked(api.list).mockResolvedValue(detail)
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
  await screen.findByText('Assassin’s Creed', { selector: 'h1' })
  await act(async () => {})
}

const rowIds = () => Array.from(document.querySelectorAll('[data-row-id]')).map((row) => (row as HTMLElement).dataset['rowId'])
const row = (id: string) => document.querySelector(`[data-row-id="${id}"]`) as HTMLElement
const type = (value: string) => fireEvent.change(screen.getByPlaceholderText('Filter items…'), { target: { value } })
const bar = () => document.querySelector('.q-filterbar') as HTMLElement
const facet = (name: string) => within(bar()).getByRole('button', { name })

describe('the bar', () => {
  it('shows the note and the facets the list has values for, in canonical order', async () => {
    await open()

    expect(within(bar()).getByText('6 items')).toBeTruthy()
    const labels = Array.from(bar().querySelectorAll('.q-facet button')).map((button) => button.textContent)
    expect(labels).toEqual(['All', 'PS3', 'PSP', 'X360', 'NDS', 'PC', 'MULTI', 'Untagged'])
  })

  it('shows no facets for a category without a convention, only the text field', async () => {
    await open('tv')

    expect(bar().querySelector('.q-facet')).toBeNull()
    expect(screen.getByPlaceholderText('Filter items…')).toBeTruthy()
  })
})

describe('filtering', () => {
  it('hides rows whose title does not match, keeping the order, and says how many are shown', async () => {
    await open()

    type('assassin')

    expect(rowIds()).toEqual(['gm', 'ac1', 'ac2'])
    expect(within(bar()).getByText('2 of 6 shown')).toBeTruthy()
  })

  it('shows a group’s own count of what matches while filtering', async () => {
    await open()

    type('assassin')

    expect(within(row('gm')).getByText('2 of 3')).toBeTruthy()
  })

  it('opens a collapsed group that has a match, without remembering that it did', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Main']))
    await open()
    expect(rowIds()).not.toContain('ac1')

    type('assassin')

    expect(rowIds()).toContain('ac1')
    expect(store.get('list:L1:collapsed')).toBe(JSON.stringify(['Main']))

    type('')
    expect(rowIds()).not.toContain('ac1')
  })

  it('filters by a platform, and any selected platform matches', async () => {
    await open()

    fireEvent.click(facet('NDS'))
    expect(rowIds()).toEqual(['gh', 'ch'])

    fireEvent.click(facet('PC'))
    expect(rowIds()).toEqual(['gm', 'ac1', 'ac2', 'gh', 'ch'])
  })

  it('finds untagged rows, and All clears the facet', async () => {
    await open()

    fireEvent.click(facet('Untagged'))
    expect(rowIds()).toEqual(['p'])

    fireEvent.click(facet('All'))
    expect(rowIds()).toEqual(['p', 'gm', 'ac1', 'ac2', 'ac3', 'gh', 'ch', 'bl'])
  })

  it('says so when nothing matches', async () => {
    await open()

    type('zzz')

    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy()
    expect(rowIds()).toEqual([])
  })

  it('says so without quoting when only a facet is on', async () => {
    await open()

    fireEvent.click(facet('NDS'))
    type('assassin')

    expect(screen.getByText('Nothing matches “assassin”.')).toBeTruthy()
  })
})

describe('fold all', () => {
  it('collapses every group while any is open, and remembers it', async () => {
    await open()

    fireEvent.click(within(bar()).getByRole('button', { name: 'Collapse all' }))

    expect(rowIds()).toEqual(['p', 'gm', 'gh'])
    await waitFor(() => expect(store.get('list:L1:collapsed')).toBe(JSON.stringify(['Main', 'Handhelds'])))
    expect(within(bar()).getByRole('button', { name: 'Expand all' })).toBeTruthy()
  })

  it('expands them all when every group is closed', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Main', 'Handhelds']))
    await open()

    fireEvent.click(within(bar()).getByRole('button', { name: 'Expand all' }))

    expect(rowIds()).toEqual(['p', 'gm', 'ac1', 'ac2', 'ac3', 'gh', 'ch', 'bl'])
  })

  it('is not offered for a list with one group or none', async () => {
    const one = list()
    one.groups = [one.groups[0]!]
    one.items = one.items.filter((entry) => entry.group !== 'Handhelds')
    vi.mocked(api.list).mockResolvedValue(one)
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <OverlayManagerProvider>
            <ListScreen listId="L1" mediaTypes={TYPES} pendingUpdates={createPendingUpdates({ get: async () => undefined, set: async () => {} })} />
          </OverlayManagerProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )
    await screen.findByText('Assassin’s Creed', { selector: 'h1' })

    expect(within(bar()).queryByRole('button', { name: /Collapse all|Expand all/ })).toBeNull()
  })
})

describe('moving rows while filtered', () => {
  const shiftDown = (id: string) => {
    act(() => row(id).focus())
    fireEvent.keyDown(row(id), { key: 'ArrowDown', shiftKey: true })
  }

  it('Shift+↓ puts a row just past the next one that is shown', async () => {
    // ac2 (Xbox 360 only) is filtered out between ac1 and ac3: from ac1, one step goes after ac3.
    await open('game', (detail) => {
      detail.items.find((entry) => entry.id === 'ac2')!.tags = ['X360']
      detail.items.find((entry) => entry.id === 'ac3')!.tags = ['PC']
    })
    fireEvent.click(facet('PC'))
    expect(rowIds()).toEqual(['gm', 'ac1', 'ac3'])

    shiftDown('ac1')

    await waitFor(() => expect(rowIds()).toEqual(['gm', 'ac3', 'ac1']))
    expect(api.restoreOrder).toHaveBeenCalledTimes(1)
    // Saved in full order: ac2 first, then ac3, then ac1.
    const saved = vi.mocked(api.restoreOrder).mock.calls[0]![1].items
    const order = new Map(saved.map((entry) => [entry.id, entry.orderIndex]))
    expect(order.get('ac3')!).toBeLessThan(order.get('ac1')!)
  })

  it('arrow keys walk only the rows that are shown', async () => {
    await open()
    fireEvent.click(facet('NDS'))
    act(() => row('gh').focus())

    fireEvent.keyDown(row('gh'), { key: 'ArrowDown' })

    expect(document.activeElement).toBe(row('ch'))
  })
})

describe('platform chips (Games)', () => {
  const chip = (id: string) => row(id).querySelector('.q-plat') as HTMLElement | null

  it('shows MULTI for several platforms, the code for one, and an empty slot for none', async () => {
    await open()

    expect(chip('ac1')!.textContent).toBe('MULTI')
    expect(chip('ac3')!.textContent).toBe('MULTI')
    expect(chip('ch')!.textContent).toBe('NDS')
    expect(chip('p')).toBeNull()
    expect(row('p').querySelector('.q-plat-gap')).toBeTruthy()
  })

  it('opens the platform popover with full names, and never toggles the row', async () => {
    await open()

    fireEvent.click(chip('ac1')!)

    const card = await screen.findByText('Platforms · 3')
    expect(card).toBeTruthy()
    expect(screen.getByText('PlayStation 3')).toBeTruthy()
    expect(row('ac1').classList.contains('is-done')).toBe(false)
    expect(api.setConsumed).not.toHaveBeenCalled()
  })

  it('explains a bare multi without naming platforms', async () => {
    await open()

    fireEvent.click(chip('ac3')!)

    expect(await screen.findByText('Multi-platform')).toBeTruthy()
    expect(screen.getByText(/doesn't name them/)).toBeTruthy()
  })

  it('keeps the plain first-tag label in a category without a platform convention', async () => {
    await open('tv')

    expect(chip('ac1')).toBeNull()
    expect(row('ac1').querySelector('.q-tag')!.textContent).toBe('PS3')
  })
})
