// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type ListGroup, type ListItem, type MediaListDetail, type MediaType } from '../../lib/api.js'
import { createPendingUpdates } from '../../lib/pendingUpdates.js'
import { LiveRegionProvider } from '../../components/quantum/LiveRegion/LiveRegion.js'
import { OverlayManagerProvider } from '../../components/quantum/overlay/OverlayManagerContext.js'
import { ToastProvider } from '../../components/quantum/Toast/Toast.js'
import { ListScreen } from './ListScreen.js'
import { hoverTooltip } from '../../components/quantum/Tooltip/hoverTooltip.js'

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
  api: { list: vi.fn(), restoreOrder: vi.fn(), setConsumed: vi.fn(), itemSource: vi.fn() },
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
  {
    key: 'mega',
    label: 'Mega',
    sortOrder: 3,
    defaultDurationMinutes: 120,
    searchAvailable: true,
    previewable: true,
    facets: [{ key: 'type', label: 'Medium', values: [{ tag: 'game', label: 'Game' }, { tag: 'movie', label: 'Movie' }] }],
  },
  { key: 'tv', label: 'TV Shows', sortOrder: 2, defaultDurationMinutes: 30, searchAvailable: true, previewable: true },
  {
    key: 'music',
    label: 'Music',
    sortOrder: 4,
    defaultDurationMinutes: 45,
    searchAvailable: true,
    previewable: true,
    facets: [
      {
        key: 'type',
        label: 'Type',
        keepOrder: true,
        prevails: 'Compilation',
        values: ['Album', { tag: 'Mini', label: 'Mini', aliases: ['EP', 'Single'] }, { tag: 'Compilation', label: 'Compilation', short: 'Comp', aliases: ['Comp'] }],
      },
      { key: 'extra', label: 'Recording', flag: true, values: ['Live'] },
    ],
  },
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
      item('ac3', 'Revelations', 3, 'Main', ['PS3', 'X360']),
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
  vi.mocked(api.itemSource).mockResolvedValue({ sourced: false, tags: null })
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
/** A facet option: on the bar, or in the Platform dropdown's popover (always a dropdown, owner 2026-10-05), opened if need be. */
const facet = (name: string) => {
  const onBar = within(bar()).queryByRole('button', { name })
  if (onBar) return onBar
  if (!screen.queryByRole('dialog')) fireEvent.click(within(bar()).getByRole('button', { name: /^Platform: / }))
  return within(screen.getByRole('dialog')).getByRole('button', { name })
}

describe('the bar', () => {
  it('shows the note and the facets the list has values for, in canonical order', async () => {
    await open()

    expect(within(bar()).getByText('6 items')).toBeTruthy()
    // Platform is always a dropdown (owner, 2026-10-05); its chips are in the popover.
    fireEvent.click(within(bar()).getByRole('button', { name: 'Platform: All' }))
    const labels = Array.from(screen.getByRole('dialog').querySelectorAll('.q-facet button')).map((button) => button.textContent)
    // Old tags (PC, NDS) read as today's codes (10.24c); the buttons run A to Z, then Untagged.
    expect(labels).toEqual(['All', 'DS', 'PS3', 'PSP', 'WIN', 'X360', '(unknown)'])
  })

  it('sits below the coloured header block, not inside it (prototype: the header ends at its rule)', async () => {
    await open()

    expect(bar().closest('.q-list-head')).toBeNull()
    expect(document.querySelector('.q-list-head')!.nextElementSibling).toBe(bar())
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

    fireEvent.click(facet('DS'))
    expect(rowIds()).toEqual(['gh', 'ch'])

    fireEvent.click(facet('WIN'))
    expect(rowIds()).toEqual(['gm', 'ac1', 'ac2', 'gh', 'ch'])
  })

  it('finds untagged rows, and All clears the facet', async () => {
    await open()

    fireEvent.click(facet('(unknown)'))
    expect(rowIds()).toEqual(['p'])

    fireEvent.click(facet('All'))
    expect(rowIds()).toEqual(['p', 'gm', 'ac1', 'ac2', 'ac3', 'gh', 'ch', 'bl'])
  })

  it('says so when nothing matches', async () => {
    await open()

    type('zzz')

    expect(screen.getByText('Nothing matches “zzz”')).toBeTruthy()
    expect(rowIds()).toEqual([])
  })

  it('quotes what was typed even while a facet is on', async () => {
    await open()

    fireEvent.click(facet('DS'))
    type('assassin')

    expect(screen.getByText('Nothing matches “assassin”')).toBeTruthy()
  })
})

describe('Hide Completed (18.1)', () => {
  const doneOf = (...ids: string[]) => (detail: MediaListDetail) => {
    for (const entry of detail.items) if (ids.includes(entry.id)) entry.consumedAt = '2026-01-01'
  }
  const hideDone = () => within(bar()).getByRole('button', { name: 'Hide Completed' })

  it('hides the done items and any group left empty, and counts as filtering', async () => {
    await open('game', doneOf('ch', 'bl', 'ac1'))

    act(() => hideDone().click())

    expect(hideDone().getAttribute('aria-pressed')).toBe('true')
    expect(rowIds()).toEqual(['p', 'gm', 'ac2', 'ac3'])
    expect(within(bar()).getByText('3 of 6 shown')).toBeTruthy()
    expect(within(row('gm')).getByText('2 of 3')).toBeTruthy()

    act(() => hideDone().click())

    expect(rowIds()).toEqual(['p', 'gm', 'ac1', 'ac2', 'ac3', 'gh', 'ch', 'bl'])
  })

  it('leaves an item ticked while it is on where it is, until it is switched again', async () => {
    vi.mocked(api.setConsumed).mockResolvedValue({} as never)
    await open('game', doneOf('ac1'))
    act(() => hideDone().click())

    fireEvent.click(within(row('ac2')).getByText('Assassin’s Creed II'))

    expect(api.setConsumed).toHaveBeenCalledWith('L1', 'ac2', true)
    expect(rowIds()).toContain('ac2')

    act(() => hideDone().click())
    act(() => hideDone().click())

    expect(rowIds()).not.toContain('ac2')
  })

  it('says everything is done when nothing is left', async () => {
    await open('game', doneOf('p', 'ac1', 'ac2', 'ac3', 'ch', 'bl'))

    act(() => hideDone().click())

    expect(rowIds()).toEqual([])
    expect(screen.getByText('Everything in this list is done')).toBeTruthy()
    expect(screen.queryByText('Nothing matches this filter')).toBeNull()
  })

  it('still says nothing matches when the text finds nothing left', async () => {
    await open('game', doneOf('ac1', 'ac2'))
    act(() => hideDone().click())

    type('assassin')

    expect(screen.getByText('Nothing matches “assassin”')).toBeTruthy()
  })

  it('combines with the text: a done match stays hidden and does not open its group', async () => {
    await open('game', doneOf('ch'))
    act(() => hideDone().click())

    type('chronicles')

    expect(rowIds()).toEqual([])
  })
})

describe('fold all', () => {
  it('collapses every group while any is open, and remembers it', async () => {
    await open()

    fireEvent.click(within(bar()).getByRole('button', { name: 'Collapse' }))

    expect(rowIds()).toEqual(['p', 'gm', 'gh'])
    await waitFor(() => expect(store.get('list:L1:collapsed')).toBe(JSON.stringify(['Main', 'Handhelds'])))
    expect(within(bar()).getByRole('button', { name: 'Expand' })).toBeTruthy()
  })

  it('expands them all when every group is closed', async () => {
    store.set('list:L1:collapsed', JSON.stringify(['Main', 'Handhelds']))
    await open()

    fireEvent.click(within(bar()).getByRole('button', { name: 'Expand' }))

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
    fireEvent.click(facet('WIN'))
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
    fireEvent.click(facet('DS'))
    act(() => row('gh').focus())

    fireEvent.keyDown(row('gh'), { key: 'ArrowDown' })

    expect(document.activeElement).toBe(row('ch'))
  })
})

describe('platform chips (Games)', () => {
  const chip = (id: string) => row(id).querySelector('.q-plat') as HTMLElement | null

  const addTag = (id: string) => row(id).querySelector('.q-tag-add') as HTMLElement | null

  it('shows MULTI for several platforms, the code for one, and a + for none', async () => {
    await open()

    expect(chip('ac1')!.textContent).toBe('MULTI')
    expect(chip('ac3')!.textContent).toBe('MULTI')
    expect(chip('ch')!.textContent).toBe('DS')
    // A drawn plus, bolder than the text glyph (owner).
    expect(addTag('p')!.querySelector('svg')).toBeTruthy()
    expect(addTag('p')!.getAttribute('aria-label')).toBe('Set platforms for Prologue')
  })

  it('hides the whole column while no item has a tag (U5, owner)', async () => {
    await open('game', (detail) => {
      for (const entry of detail.items) entry.tags = null
    })

    expect(document.querySelector('.q-plat, .q-tag-add, .q-plat-gap')).toBeNull()
  })

  it('+ opens the Edit window with the Platform panel open, and never toggles the row', async () => {
    await open()

    fireEvent.click(addTag('p')!)

    expect(await screen.findByRole('dialog', { name: 'Choose platforms' })).toBeTruthy()
    expect(within(document.querySelector('.q-pop') as HTMLElement).getByLabelText('Title')).toBeTruthy()
    expect(api.setConsumed).not.toHaveBeenCalled()
  })

  it('the platform card’s Edit opens the Edit window with the panel open', async () => {
    await open()
    fireEvent.click(chip('ac1')!)
    await screen.findByText('Platforms · 3')

    fireEvent.click(screen.getByRole('button', { name: 'Edit platforms for Assassin’s Creed' }))

    expect(await screen.findByRole('dialog', { name: 'Choose platforms' })).toBeTruthy()
    expect(document.querySelector('.q-platcard')).toBeNull()
  })

  it('a short fixed set (Mega) gets a + too, opening the Edit window with its Medium field', async () => {
    // Mega starts with its groups folded: keep every row loose so all are on screen.
    await open('mega', (detail) => {
      detail.groups = []
      for (const entry of detail.items) {
        entry.group = null
        entry.tags = entry.id === 'ac1' ? ['game'] : null
      }
    })

    expect(addTag('ac1')).toBeNull()
    expect(addTag('p')!.getAttribute('aria-label')).toBe('Set medium for Prologue')
    fireEvent.click(addTag('p')!)

    await waitFor(() => expect(document.querySelector('.q-pop')).toBeTruthy())
    expect(within(document.querySelector('.q-pop') as HTMLElement).getByRole('button', { name: /^Medium:/ })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Choose platforms' })).toBeNull()
  })

  it('offers no + in a category without a tag field', async () => {
    await open('tv')

    expect(addTag('p')).toBeNull()
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

  it('keeps the plain first-tag label in a category without a platform convention', async () => {
    await open('tv')

    expect(chip('ac1')).toBeNull()
    expect(row('ac1').querySelector('.q-tag')!.textContent).toBe('PS3')
  })
})

describe('Mega mediums', () => {
  it('shows the display name in the tag column and on the facet, filtering by the tag', async () => {
    // A Mega list's groups arrive collapsed; these are looked at open.
    store.set('list:L1:collapsed', JSON.stringify([]))
    await open('mega', (detail) => {
      detail.items.find((entry) => entry.id === 'ac1')!.tags = ['game']
      detail.items.find((entry) => entry.id === 'ac2')!.tags = ['Movie']
    })

    expect(row('ac1').querySelector('.q-tag')!.textContent).toBe('Game')
    expect(row('ac2').querySelector('.q-tag')!.textContent).toBe('Movie')
    expect(Array.from(bar().querySelectorAll('.q-facet button')).map((button) => button.textContent)).toEqual([
      'All',
      'Game',
      'Movie',
      '(unknown)',
    ])

    fireEvent.click(facet('Game'))
    expect(rowIds()).toEqual(['gm', 'ac1'])
  })
})

describe('the last opened list', () => {
  it('is remembered when a list opens, for I’m Tired, Boss to start from', async () => {
    await open()

    await waitFor(() => expect(store.get('lastOpenedList')).toBe('L1'))
  })
})

describe('a Music list (owner, 2026-09-27)', () => {
  const music = (detail: MediaListDetail) => {
    detail.items = [
      item('a', 'Oceanic', 0, null, ['Album']),
      item('l', 'Live I', 1, null, ['Album', 'Live']),
      item('e', 'The Red Sea', 2, null, ['EP']),
      item('c', 'Temporal', 3, null, ['Album', 'Compilation']),
    ]
    detail.groups = []
  }

  it('reads each row’s type, Live as a mark on it: EP as Mini, a compilation as Comp', async () => {
    await open('music', music)

    const chip = (id: string) => row(id).querySelector('.q-tag.kind') as HTMLElement
    expect(chip('a').textContent).toBe('Album')
    expect(chip('a').querySelector('.q-tag-mark')).toBeNull()
    // The chip is 58px: Live is a mark on it, named on hover and to a screen reader (owner).
    expect(chip('l').querySelector('.q-tag-mark')).toBeTruthy()
    expect(await hoverTooltip(chip('l'))).toBe('Album · Live')
    expect(chip('l').textContent).toBe('Album · Live')
    expect(chip('e').textContent).toBe('Mini')
    expect(chip('c').textContent).toBe('Comp')
    // Comp is the chip's short name only; the filter bar says Compilation (owner).
    expect(facet('Compilation')).toBeTruthy()
  })

  it('filters Type and Recording apart: Album with Live on shows live albums only', async () => {
    await open('music', music)
    expect(within(bar()).getByText('Recording')).toBeTruthy()

    fireEvent.click(facet('Album'))
    expect(rowIds()).toEqual(['a', 'l'])
    fireEvent.click(facet('Live'))
    expect(rowIds()).toEqual(['l'])
  })
})
