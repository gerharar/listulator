// @vitest-environment jsdom
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MediaList, MediaType } from '../../../lib/api.js'
import { api } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { CategoryPicker } from './CategoryPicker.js'

vi.mock('../../../lib/api.js', () => ({
  api: {
    lists: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mediaType(overrides: Partial<MediaType> & Pick<MediaType, 'key' | 'label'>): MediaType {
  return {
    sortOrder: 10,
    defaultDurationMinutes: 30,
    searchAvailable: true,
    previewable: true,
    sourceName: 'TMDB',
    ...overrides,
  }
}

const REGISTRY: MediaType[] = [
  mediaType({ key: 'wrestling', label: 'Wrestling', sortOrder: 40, sourceName: 'Wikipedia' }),
  mediaType({ key: 'movie', label: 'Movies', sortOrder: 10 }),
  mediaType({ key: 'tv', label: 'TV Shows', sortOrder: 20 }),
]

function listIn(mediaTypeKey: string, id: string): MediaList {
  return { id, mediaType: mediaTypeKey } as MediaList
}

function StackReader() {
  const { stack } = useLayerStack()
  return (
    <span data-testid="stack">
      {stack.map((layer) => `${layer.kind}:${layer.content}`).join(',')}
    </span>
  )
}

const PICKER_LAYER = {
  id: 'category-picker',
  kind: 'category-picker',
  tabLabel: 'Pick',
  content: '/',
}

/** Puts the picker on top of Home, the ordinary (non-first-run) way to reach it. */
function SeedPickerLayer() {
  const { push } = useLayerStack()
  useEffect(() => push(PICKER_LAYER), [push])
  return null
}

function renderPicker(mediaTypes: MediaType[], { first = false } = {}) {
  const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

  return render(
    <LayerStackProvider home={home}>
      <StackReader />
      {!first && <SeedPickerLayer />}
      <CategoryPicker mediaTypes={mediaTypes} first={first} />
    </LayerStackProvider>,
  )
}

function tiles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.q-tile'))
}

describe('CategoryPicker', () => {
  it('renders one tile per registry entry, in sortOrder, with the display label from the locale', async () => {
    vi.mocked(api.lists).mockResolvedValue([])

    renderPicker(REGISTRY)

    expect(tiles().map((tile) => within(tile).getByText(/./, { selector: 'b' }).textContent)).toEqual([
      'Movies',
      // The registry says "TV Shows"; the locale's display label wins (C1).
      'TV Series',
      'Pro Wrestling',
    ])
  })

  it('renders a 13th tile for a registry entry the code has never heard of, with fallback art and its registry label', async () => {
    vi.mocked(api.lists).mockResolvedValue([])
    const podcast = mediaType({ key: 'podcast', label: 'Podcasts', sortOrder: 110, sourceName: undefined })
    const twelve = Array.from({ length: 12 }, (_, index) =>
      mediaType({ key: `cat-${index}`, label: `Cat ${index}`, sortOrder: index }),
    )

    renderPicker([...twelve, podcast])

    expect(tiles()).toHaveLength(13)
    const tile = tiles().at(-1)!
    expect(within(tile).getByText('Podcasts')).not.toBeNull()
    // The fallback art box renders, holding no drawing (no code change needed for a new key).
    const art = tile.querySelector('.q-category-art')
    expect(art).not.toBeNull()
    expect(art?.querySelectorAll('path')).toHaveLength(0)
  })

  it("footers come from the live registry: a source's own name, and 'by hand' only with no search source", () => {
    vi.mocked(api.lists).mockResolvedValue([])
    const byHand = mediaType({ key: 'podcast', label: 'Podcasts', sortOrder: 110, sourceName: undefined, searchAvailable: false, previewable: false })

    renderPicker([...REGISTRY, byHand])

    const footer = (label: string) =>
      tiles().find((tile) => within(tile).queryByText(label))!.querySelector('.q-tile-src')?.textContent
    // The handoff's table says wrestling is "by hand"; the registry says Wikipedia, and the registry wins.
    expect(footer('Pro Wrestling')).toBe('Wikipedia')
    expect(footer('Movies')).toBe('TMDB')
    expect(footer('Podcasts')).toBe('by hand')
  })

  it('shows a count chip only on shelves that already hold lists', async () => {
    vi.mocked(api.lists).mockResolvedValue([listIn('movie', 'a'), listIn('movie', 'b'), listIn('tv', 'c')])

    renderPicker(REGISTRY)

    await waitFor(() => expect(document.querySelectorAll('.q-count-chip')).toHaveLength(2))
    const chip = (label: string) =>
      tiles().find((tile) => within(tile).queryByText(label))!.querySelector('.q-count-chip')?.textContent
    expect(chip('Movies')).toBe('2')
    expect(chip('TV Series')).toBe('1')
    expect(chip('Pro Wrestling')).toBeUndefined()
    // A shelf with lists takes the filled ground.
    expect(tiles()[0]!.classList.contains('used')).toBe(true)
    expect(tiles()[2]!.classList.contains('used')).toBe(false)
  })

  it('still lists every category when the lists fetch fails, just without counts', async () => {
    vi.mocked(api.lists).mockRejectedValue(new Error('nope'))

    renderPicker(REGISTRY)

    await waitFor(() => expect(api.lists).toHaveBeenCalled())
    expect(tiles()).toHaveLength(3)
    expect(document.querySelectorAll('.q-count-chip')).toHaveLength(0)
  })

  it('picking a tile pushes the create layer for that category', () => {
    vi.mocked(api.lists).mockResolvedValue([])

    renderPicker(REGISTRY)
    fireEvent.click(screen.getByRole('button', { name: /Pro Wrestling/ }))

    expect(screen.getByTestId('stack').textContent).toBe(
      'home:/,category-picker:/,new-list:/lists/new?mediaType=wrestling',
    )
  })

  it('on first run it is the base layer: the headline changes, there is no close button and no count chip, and no lists are fetched', () => {
    renderPicker(REGISTRY, { first: true })

    expect(screen.getByRole('heading', { name: 'Nothing tracked yet — pick a shelf and fill it' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(document.querySelectorAll('.q-count-chip')).toHaveLength(0)
    expect(api.lists).not.toHaveBeenCalled()
  })

  it('has a close button when reached from Home, and it pops the picker', async () => {
    vi.mocked(api.lists).mockResolvedValue([])

    renderPicker(REGISTRY)
    expect(screen.getByTestId('stack').textContent).toBe('home:/,category-picker:/')

    expect(screen.getByRole('heading', { name: 'Pick A Category' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('stack').textContent).toBe('home:/')
  })
})
