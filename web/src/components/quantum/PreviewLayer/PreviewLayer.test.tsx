// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api, ApiError, type MediaType } from '../../../lib/api.js'
import { createFromSourceInput, type PreviewSource } from '../../../lib/preview.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
import { PreviewLayer } from './PreviewLayer.js'

vi.mock('../../../lib/api.js', async () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message)
    }
  }

  return { ApiError: MockApiError, api: { preview: vi.fn(), createFromSource: vi.fn() } }
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const TV: MediaType = {
  key: 'tv',
  label: 'TV Shows',
  sortOrder: 10,
  defaultDurationMinutes: 40,
  searchAvailable: true,
  previewable: true,
  sourceName: 'TMDB',
}

const SOURCE: PreviewSource = {
  mediaType: 'tv',
  externalRef: 'show:1',
  title: 'Loki',
  options: {},
}

const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

function renderLayer(source: PreviewSource = SOURCE, onBuilt = vi.fn()) {
  render(
    <LayerStackProvider home={home}>
      <PreviewLayer source={source} mediaType={TV} onBuilt={onBuilt} />
    </LayerStackProvider>,
  )
  return onBuilt
}

const EXPANSION = {
  itemCount: 3,
  status: 'ongoing' as const,
  items: [
    { title: 'Glorious Purpose', timeToConsumeMinutes: 50, year: 2021, group: 'Season 1' },
    { title: 'The Variant', timeToConsumeMinutes: 47, group: 'Season 1' },
    { title: 'Ouroboros' },
  ],
}

describe('PreviewLayer', () => {
  it('shows a spinner while listing, then the title, count and total runtime', async () => {
    vi.mocked(api.preview).mockResolvedValue(EXPANSION)
    renderLayer()

    expect(screen.getByText('Listing the items…')).toBeTruthy()
    // 50 + 47 + the category default (40), so an estimate: 2h 17m.
    expect(await screen.findByText('3 items · ≈ 2h 17m')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^Loki/ })).toBeTruthy()
    expect(screen.getByText('Ongoing')).toBeTruthy()
    expect(api.preview).toHaveBeenCalledWith('tv', 'show:1', {})
  })

  it('lists every item in arrival order, under plain group toggles', async () => {
    vi.mocked(api.preview).mockResolvedValue(EXPANSION)
    renderLayer()

    await screen.findByText('Glorious Purpose')
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Glorious Purpose')).toBeLessThan(text.indexOf('The Variant'))
    expect(text.indexOf('The Variant')).toBeLessThan(text.indexOf('Ouroboros'))

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Season 1' }))
    expect(screen.queryByText('Glorious Purpose')).toBeNull()
    expect(screen.getByText('Ouroboros')).toBeTruthy()
  })

  it('adds the list with exactly the request a result row sends, then opens it', async () => {
    vi.mocked(api.preview).mockResolvedValue(EXPANSION)
    vi.mocked(api.createFromSource).mockResolvedValue({ id: 'L1' } as never)
    const source: PreviewSource = { ...SOURCE, options: { includeEp: true } }
    const onBuilt = renderLayer(source)
    await screen.findByText('Glorious Purpose')

    fireEvent.click(screen.getByRole('button', { name: 'Add This List' }))

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L1'))
    expect(api.createFromSource).toHaveBeenCalledWith(createFromSourceInput(source))
  })

  it('locks while adding', async () => {
    vi.mocked(api.preview).mockResolvedValue(EXPANSION)
    vi.mocked(api.createFromSource).mockReturnValue(new Promise(() => {}))
    renderLayer()
    await screen.findByText('Glorious Purpose')

    fireEvent.click(screen.getByRole('button', { name: 'Add This List' }))

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Building the list…' }) as HTMLButtonElement).disabled).toBe(true),
    )
  })

  it('says so when the source has nothing, and offers no Add list', async () => {
    vi.mocked(api.preview).mockResolvedValue({ itemCount: 0, items: [] })
    renderLayer()

    expect(await screen.findByText(/Nothing to add/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add This List' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the failure in the same place, with Retry', async () => {
    vi.mocked(api.preview).mockRejectedValueOnce(new ApiError('TMDB is rate-limiting us.', 502))
    vi.mocked(api.preview).mockResolvedValueOnce(EXPANSION)
    renderLayer()

    expect(await screen.findByText('TMDB is rate-limiting us.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Add This List' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Glorious Purpose')).toBeTruthy()
  })
})

describe('PreviewLayer tag column (11.8)', () => {
  const GAMES: MediaType = {
    ...TV,
    key: 'game',
    label: 'Games',
    facets: [{ key: 'platform', label: 'Platform' }],
  }

  it('shows every platform the way the created list will: a chip per game, MULTI for several', async () => {
    vi.mocked(api.preview).mockResolvedValue({
      itemCount: 2,
      items: [
        { title: 'Halo', tags: ['Xbox', 'PC'] },
        { title: 'Gran Turismo', tags: ['PS3'] },
      ],
    })
    render(
      <LayerStackProvider home={home}>
        <PreviewLayer source={{ ...SOURCE, mediaType: 'game' }} mediaType={GAMES} onBuilt={vi.fn()} />
      </LayerStackProvider>,
    )

    await waitFor(() => expect(screen.getByText('Halo')).toBeTruthy())
    expect([...document.querySelectorAll('.q-preview-row .q-plat')].map((chip) => chip.textContent)).toEqual([
      'MULTI',
      'PS3',
    ])
  })
})

