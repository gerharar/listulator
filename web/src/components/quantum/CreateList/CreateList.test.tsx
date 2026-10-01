// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { CreateList } from './CreateList.js'

vi.mock('../../../lib/api.js', () => ({
  api: {
    createList: vi.fn(),
    importItems: vi.fn(),
    createFromFile: vi.fn(),
    searchSources: vi.fn(),
    createFromSource: vi.fn(),
    expansion: vi.fn(),
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

const TV = mediaType({ key: 'tv', label: 'TV Shows' })
const MEGA = mediaType({
  key: 'mega',
  label: 'Mega',
  description: 'Franchises that span several media at once.',
})
const PODCAST = mediaType({
  key: 'podcast',
  label: 'Podcasts',
  searchAvailable: false,
  previewable: false,
  sourceName: undefined,
})

function renderCreate(
  key: string,
  mediaTypes: MediaType[] = [TV, MEGA, PODCAST],
  seed: { initialQuery?: string; initialOpen?: string } = {},
) {
  const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

  return render(
    <OverlayManagerProvider>
      <LayerStackProvider home={home}>
        <CreateList mediaTypes={mediaTypes} mediaTypeKey={key} {...seed} />
      </LayerStackProvider>
    </OverlayManagerProvider>,
  )
}

const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent)

describe('CreateList', () => {
  it("titles the layer with the category's display label, not the registry's", () => {
    renderCreate('tv')

    expect(screen.getByRole('heading', { name: 'New TV Series List' })).not.toBeNull()
  })

  it("shows the category's own description under the title when it has one", () => {
    renderCreate('mega')

    expect(screen.getByText('Franchises that span several media at once.')).not.toBeNull()
  })

  it('offers Search {source}, Add by hand and Import a file, starting on Search', () => {
    renderCreate('tv')

    expect(tabs()).toEqual(['Search', 'Use Hands', 'Import'])
    expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it("leaves Search out for a category with no search source, and starts on Add by hand", () => {
    renderCreate('podcast')

    expect(tabs()).toEqual(['Use Hands', 'Import'])
    expect(screen.getByRole('tab', { name: 'Use Hands' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByLabelText('Title')).not.toBeNull()
  })

  it('a library-only category (Mega) searches the community library, named so on the tab (F9)', () => {
    const library = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })

    renderCreate('mega', [library])

    expect(tabs()[0]).toBe('Search')
  })

  it('keeps the Search tab for a category whose search needs a key, so it can say so', () => {
    const keyed = mediaType({ key: 'tv', label: 'TV Shows', searchAvailable: false })

    renderCreate('tv', [keyed])

    expect(tabs()).toContain('Search')
  })

  it('shows the by-hand form on its tab and the file import on the other', () => {
    renderCreate('tv')

    fireEvent.click(screen.getByRole('tab', { name: 'Use Hands' }))
    expect(screen.getByLabelText('Title')).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Import' }))
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('clears a tab\'s transient state when you leave it', () => {
    renderCreate('tv')

    fireEvent.click(screen.getByRole('tab', { name: 'Use Hands' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Half typed' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Import' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Use Hands' }))

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('')
  })

  it('falls back to the first category rather than crashing on a key the registry lacks', () => {
    renderCreate('gone', [TV])

    expect(screen.getByRole('heading', { name: 'New TV Series List' })).not.toBeNull()
  })

  it('hands a search to run and a result to open on to its Search tab (task 14.1)', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({
      sources: [{ externalRef: 'canonical:lists/mega/a.yaml', title: 'Breaking Bad franchise', detail: 'Canonical list' }],
    })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 3 })

    await act(async () => {
      renderCreate('mega', [TV, MEGA, PODCAST], { initialQuery: 'breaking bad', initialOpen: 'canonical:lists/mega/a.yaml' })
    })

    expect(api.searchSources).toHaveBeenCalledExactlyOnceWith('mega', 'breaking bad', undefined)
    expect(screen.getByRole('button', { name: /Breaking Bad franchise/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('does not search on opening without them', async () => {
    await act(async () => {
      renderCreate('tv')
    })

    expect(api.searchSources).not.toHaveBeenCalled()
  })

  it('gives its Search tab the registry’s library-scope category, so a search in another category can point at it (task 14.2)', async () => {
    const LIBRARY = mediaType({ key: 'shelf', label: 'Shelf', searchScope: 'library' })
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [] })

    await act(async () => {
      renderCreate('tv', [TV, LIBRARY], { initialQuery: 'breaking bad' })
    })

    expect(api.searchSources).toHaveBeenCalledWith('tv', 'breaking bad', undefined)
    expect(api.searchSources).toHaveBeenCalledWith('shelf', 'breaking bad')
  })

  it('does not look for another shelf from the library-scope category itself', async () => {
    const LIBRARY = mediaType({ key: 'shelf', label: 'Shelf', searchScope: 'library' })
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [] })

    await act(async () => {
      renderCreate('shelf', [TV, LIBRARY], { initialQuery: 'breaking bad' })
    })

    expect(api.searchSources).toHaveBeenCalledTimes(1)
  })
})

