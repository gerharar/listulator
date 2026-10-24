// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { api, type MediaType } from '../../../lib/api.js'
import type { PreviewSource } from '../../../lib/preview.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { RailPlacementProvider } from '../../../screens/list/RailPlacementContext.js'
import { railPlacement } from '../../../screens/list/railPlacement.js'
import { PreviewLayer } from './PreviewLayer.js'

/** The jump rail on the Preview (H-019, 32.5a): the groups of the candidate list, with how many items each has, inside or outside the card. */

const store = new Map<string, string>()

vi.mock('../../../lib/preferences/store.js', () => ({
  getPreferencesStore: () => ({
    get: async (key: string) => store.get(key),
    set: async (key: string, value: string) => void store.set(key, value),
  }),
  listPreferenceKey: (listId: string, key: string) => `list:${listId}:${key}`,
}))

vi.mock('../../../lib/api.js', () => ({
  ApiError: class extends Error {},
  api: { preview: vi.fn(), createFromSource: vi.fn() },
}))

const TV: MediaType = { key: 'tv', label: 'TV Shows', sortOrder: 10, defaultDurationMinutes: 40, searchAvailable: true, previewable: true, sourceName: 'TMDB' }
const SOURCE: PreviewSource = { mediaType: 'tv', externalRef: 'show:1', title: 'Loki', options: {} }
const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

const GROUPED = {
  itemCount: 6,
  status: 'ongoing' as const,
  items: [
    { title: 'A1', group: 'Season 1' },
    { title: 'A2', group: 'Season 1' },
    { title: 'A3', group: 'Season 1' },
    { title: 'B1', group: 'Season 2' },
    { title: 'B2', group: 'Season 2' },
    { title: 'C1', group: 'Specials' },
  ],
}

beforeEach(() => {
  store.clear()
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function open(preview: unknown = GROUPED, where: { windowWidth: number; active?: boolean; carried?: boolean } | null = null) {
  vi.mocked(api.preview).mockResolvedValue(preview as never)
  const layer = <PreviewLayer source={SOURCE} mediaType={TV} onBuilt={() => {}} {...(where?.active === false ? { active: false } : {})} />
  render(
    <LiveRegionProvider>
    <LayerStackProvider home={home}>
      {where ? (
        <RailPlacementProvider value={{ placement: railPlacement(where.windowWidth, 'inside'), windowWidth: where.windowWidth, ...(where.carried && { carried: true }) }}>{layer}</RailPlacementProvider>
      ) : (
        layer
      )}
    </LayerStackProvider>
</LiveRegionProvider>,
  )
  await waitFor(() => expect(document.querySelector('.q-preview-row, .q-preview-group')).not.toBeNull())
  await act(async () => {})
}

const rail = () => document.querySelector('.q-rail') as HTMLElement | null

describe('the jump rail on the Preview', () => {
  it('lists the groups with how many items each has, and no tick or done count', async () => {
    await open()

    const entries = within(rail()!).getAllByRole('button', { name: /Season|Specials/ })
    expect(entries.map((entry) => entry.textContent)).toEqual(['Season 13', 'Season 22', 'Specials1'])
    expect(rail()!.querySelector('.tick.complete, .q-rail-entry.complete')).toBeNull()
  })

  it('is not there for a flat preview, or one group', async () => {
    await open({ itemCount: 2, items: [{ title: 'x' }, { title: 'y' }] })
    expect(rail()).toBeNull()

    cleanup()
    await open({ itemCount: 2, items: [{ title: 'x', group: 'Only' }, { title: 'y', group: 'Only' }] })
    expect(rail()).toBeNull()
  })

  it('opens a folded group and brings it to the top of the rows', async () => {
    await open()
    const body = document.querySelector('.q-preview-body') as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Season 2' }))
    expect(screen.queryByText('B1')).toBeNull()

    fireEvent.click(within(rail()!).getByRole('button', { name: /Season 2/ }))

    await waitFor(() => expect(screen.getByText('B1')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Collapse Season 2' }).getAttribute('aria-expanded')).toBe('true')
    // Season 1's head and its three rows are 40px each.
    await waitFor(() => expect(body.scrollTop).toBe(4 * 40))
  })

  it('folds to a strip and remembers that for the next Preview, and unfolds again', async () => {
    await open()

    fireEvent.click(within(rail()!).getByRole('button', { name: 'Collapse group jumper' }))

    expect(rail()).toBeNull()
    expect(document.querySelector('.q-rail-stub')).not.toBeNull()
    await waitFor(() => expect(store.get('preview:rail')).toBe('hidden'))

    cleanup()
    await open()
    expect(rail()).toBeNull()
    fireEvent.click(document.querySelector('.q-rail-stub .label')!)
    expect(rail()).not.toBeNull()
    await waitFor(() => expect(store.get('preview:rail')).toBe('shown'))
  })

  it('is resized from its edge, within 160–480px, and remembers the width for the next Preview', async () => {
    await open()
    const grip = within(rail()!).getByRole('separator', { name: 'Resize group jumper' })
    expect(rail()!.style.width).toBe('200px')

    fireEvent.pointerDown(grip, { button: 0, clientX: 200 })
    fireEvent.pointerMove(window, { clientX: 290 })
    expect(rail()!.style.width).toBe('290px')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(store.get('preview:railWidth')).toBe('290'))

    cleanup()
    await open()
    expect(rail()!.style.width).toBe('290px')
  })
})

describe('the jump rail on the Preview carried inside', () => {
  it('follows the window after it left the card, and shows the remembered width in a window that opened inside', async () => {
    store.set('preview:railWidth', '324')
    await open(GROUPED, { windowWidth: 1500, carried: true })
    expect(rail()!.style.width).toBe('174px')

    cleanup()
    await open(GROUPED, { windowWidth: 1500 })
    expect(rail()!.style.width).toBe('324px')
  })
})

describe('the jump rail on the Preview outside the card', () => {
  it('is inside in a window with no room, and outside with it, as a child of the box that reaches the card’s bottom', async () => {
    await open(GROUPED, { windowWidth: 1512 })
    expect(rail()!.dataset['placement']).toBe('inside')

    cleanup()
    await open(GROUPED, { windowWidth: 1728 })
    expect(rail()!.dataset['placement']).toBe('outside')
    expect(rail()!.parentElement!.classList.contains('q-preview-lower')).toBe(true)
    expect(rail()!.style.width).toBe('200px')
  })

  it('has its grip on the outer edge, folds in place to the 38px strip, and unfolds on a press', async () => {
    await open(GROUPED, { windowWidth: 1728 })
    const element = rail()!
    expect(within(element).getByRole('separator').classList.contains('q-rail-grip-out')).toBe(true)

    fireEvent.click(within(element).getByRole('button', { name: 'Collapse group jumper' }))

    expect(rail()).toBe(element)
    expect(element.classList.contains('is-folded')).toBe(true)
    expect(element.style.width).toBe('38px')
    fireEvent.click(element.querySelector('.label')!)
    expect(element.classList.contains('is-folded')).toBe(false)
  })

  it('shows only on the active layer', async () => {
    await open(GROUPED, { windowWidth: 1728, active: false })

    expect(rail()).toBeNull()
  })
})
