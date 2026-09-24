// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, api, type ListSourceResult, type MediaType } from '../../../lib/api.js'
import { SearchTab } from './SearchTab.js'

vi.mock('../../../lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api.js')>()),
  api: {
    searchSources: vi.fn(),
    createFromSource: vi.fn(),
    expansion: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
})

function mediaType(overrides: Partial<MediaType> = {}): MediaType {
  return {
    key: 'tv',
    label: 'TV Shows',
    sortOrder: 20,
    defaultDurationMinutes: 50,
    searchAvailable: true,
    previewable: true,
    sourceName: 'TMDB',
    ...overrides,
  }
}

const RESULTS: ListSourceResult[] = [
  { externalRef: 'show:1', title: 'Breaking Bad', detail: 'TV · 2008' },
  { externalRef: 'show:2', title: 'Better Call Saul', detail: 'TV · 2015' },
]

function renderTab(type: MediaType = mediaType(), onBuilt = vi.fn()) {
  render(<SearchTab mediaType={type} onBuilt={onBuilt} />)
  return { onBuilt }
}

async function search(query = 'saul') {
  fireEvent.change(screen.getByLabelText(/^Search /), { target: { value: query } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  })
}

describe('SearchTab', () => {
  it('searches the chosen category and lists the results', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    renderTab()

    await search('  breaking  ')

    expect(api.searchSources).toHaveBeenCalledWith('tv', 'breaking', undefined)
    expect(await screen.findByText('Breaking Bad')).not.toBeNull()
    expect(screen.getByText('2 results')).not.toBeNull()
  })

  it('fetches every result’s count after the rows render, and shows each as it lands', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
    vi.mocked(api.expansion).mockImplementation(async (_key, ref) => ({
      itemCount: ref === 'show:1' ? 62 : 63,
      ...(ref === 'show:1' ? { status: 'complete' as const } : {}),
    }))
    renderTab()

    await search()

    await waitFor(() => expect(screen.getByText('62')).not.toBeNull())
    expect(screen.getByText('63')).not.toBeNull()
    expect(api.expansion).toHaveBeenCalledWith('tv', 'show:1', {})
    expect(api.expansion).toHaveBeenCalledWith('tv', 'show:2', {})
    // Status arrives with the count (10.11b).
    expect(screen.getByText('Complete')).not.toBeNull()
  })

  it('shows no number for a count that failed, and leaves the row usable', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [RESULTS[0]!] })
    vi.mocked(api.expansion).mockRejectedValue(new Error('rate limited'))
    renderTab()

    await search()

    await waitFor(() => expect(api.expansion).toHaveBeenCalled())
    expect(screen.getByText('Breaking Bad')).not.toBeNull()
    expect(screen.queryByText('items')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('adds the list with the chosen source, then reports the new list', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    vi.mocked(api.createFromSource).mockResolvedValue({ id: 'list-9' } as never)
    const { onBuilt } = renderTab()

    await search()
    fireEvent.click(await screen.findByRole('button', { name: /Better Call Saul/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add list' }))
    })

    expect(api.createFromSource).toHaveBeenCalledWith({
      mediaType: 'tv',
      externalRef: 'show:2',
      title: 'Better Call Saul',
    })
    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('list-9'))
  })

  it('locks everything with a spinner while adding, and stops queueing speculative counts', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
    // Counts never settle, so any still queued when Add is clicked would start afterwards.
    vi.mocked(api.expansion).mockImplementation(() => new Promise(() => {}))
    vi.mocked(api.createFromSource).mockImplementation(() => new Promise(() => {}))
    renderTab(mediaType(), vi.fn())
    const three = [...RESULTS, { externalRef: 'show:3', title: 'Third' }]
    vi.mocked(api.searchSources).mockResolvedValue({ sources: three })

    await search()
    await screen.findByText('Third')
    const startedBefore = vi.mocked(api.expansion).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Breaking Bad/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add list' }))
    })

    expect(screen.getByRole('status', { name: 'Building the list…' })).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(/^Search /) as HTMLInputElement).disabled).toBe(true)
    expect(vi.mocked(api.expansion).mock.calls.length).toBe(startedBefore)
  })

  it('says nothing was found, in the same slot errors use', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [] })
    renderTab()

    await search('zzzz')

    expect(await screen.findByText('Nothing found')).not.toBeNull()
    expect(screen.getByText('Try a different spelling, or add by hand.')).not.toBeNull()
  })

  it('shows a hard "needs a key" block up front when the category has no usable source, on the web pointing at .env', () => {
    renderTab(mediaType({ searchAvailable: false }))

    expect(screen.getByText('Search needs a TMDB key')).not.toBeNull()
    expect(screen.getByText(/\.env file/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
  })

  it('on desktop points at Settings, with Open Settings disabled until Settings exists', () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    renderTab(mediaType({ searchAvailable: false }))

    expect(screen.getByText(/Add your key in Settings/)).not.toBeNull()
    const open = screen.getByRole('button', { name: 'Open Settings' }) as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(open.title).toBe('Settings is coming soon')
  })

  it('treats a search.unavailable answer as the same hard block', async () => {
    vi.mocked(api.searchSources).mockRejectedValue(
      new ApiError('Search is not available for TV Shows.', 409, 'search.unavailable'),
    )
    renderTab()

    await search()

    expect(await screen.findByText('Search needs a TMDB key')).not.toBeNull()
  })

  it('shows a recoverable failure as a strip, and Retry runs the search again', async () => {
    vi.mocked(api.searchSources)
      .mockRejectedValueOnce(new ApiError('TMDB is rate-limiting us. Try again in a moment.', 502))
      .mockResolvedValueOnce({ sources: RESULTS })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    renderTab()

    await search()
    expect(await screen.findByText('TMDB is rate-limiting us. Try again in a moment.')).not.toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    expect(await screen.findByText('Breaking Bad')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets a strip be dismissed', async () => {
    vi.mocked(api.searchSources).mockRejectedValue(new ApiError('Cannot reach the server.', 0))
    renderTab()

    await search()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed add is a strip whose Retry tries the add again', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [RESULTS[0]!] })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    vi.mocked(api.createFromSource)
      .mockRejectedValueOnce(new ApiError('TMDB returned 500.', 502))
      .mockResolvedValueOnce({ id: 'list-1' } as never)
    const { onBuilt } = renderTab()

    await search()
    fireEvent.click(await screen.findByRole('button', { name: /Breaking Bad/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add list' }))
    })
    await screen.findByText('TMDB returned 500.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('list-1'))
    expect(api.createFromSource).toHaveBeenCalledTimes(2)
  })

  it("ignores a slow earlier search's answer once a newer search has been made", async () => {
    let releaseFirst: (value: { sources: ListSourceResult[] }) => void = () => {}
    vi.mocked(api.searchSources)
      .mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce({ sources: [RESULTS[1]!] })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    renderTab()

    await search('first')
    await search('second')
    await screen.findByText('Better Call Saul')
    await act(async () => releaseFirst({ sources: [RESULTS[0]!] }))

    expect(screen.queryByText('Breaking Bad')).toBeNull()
  })

  describe('book language and music types', () => {
    it('sends the language filter for books, and not for other categories', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      renderTab(mediaType({ key: 'book', label: 'Books', sourceName: 'Open Library' }))

      fireEvent.click(screen.getByRole('button', { name: 'English' }))
      await search()

      expect(api.searchSources).toHaveBeenCalledWith('book', 'saul', {
        language: 'eng',
        includeUnknown: false,
      })
      expect(api.expansion).toHaveBeenCalledWith('book', 'show:1', {
        language: 'eng',
        includeUnknown: false,
      })
    })

    it('counts music with the same discography types an import would use, and refetches when they change', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: [RESULTS[0]!] })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 10 })
      renderTab(mediaType({ key: 'music', label: 'Music', sourceName: 'MusicBrainz' }))

      await search()
      await waitFor(() => expect(api.expansion).toHaveBeenCalledTimes(1))
      expect(api.expansion).toHaveBeenLastCalledWith('music', 'show:1', {
        includeEp: true,
        includeSingle: true,
        includeLive: false,
        includeCompilation: false,
      })
      expect(api.searchSources).toHaveBeenCalledWith('music', 'saul', undefined)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Live albums' }))
      })

      await waitFor(() => expect(api.expansion).toHaveBeenCalledTimes(2))
      expect(api.expansion).toHaveBeenLastCalledWith('music', 'show:1', {
        includeEp: true,
        includeSingle: true,
        includeLive: true,
        includeCompilation: false,
      })
    })

    it('shows neither control for a category that reads neither', () => {
      renderTab()

      expect(screen.queryByRole('button', { name: 'English' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Live albums' })).toBeNull()
    })
  })
})
