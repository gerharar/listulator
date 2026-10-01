// @vitest-environment jsdom
import { StrictMode, useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, api, type ListSourceResult, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
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

const HOME = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

/** Shows what the layer stack holds, so a test can see a pushed layer. */
function StackProbe() {
  const { stack } = useLayerStack()

  return (
    <>
      <output data-testid="stack">{JSON.stringify(stack.map((layer) => [layer.kind, layer.content]))}</output>
      <output data-testid="stack-ids">{JSON.stringify(stack.map((layer) => layer.id))}</output>
    </>
  )
}

function renderTab(
  type: MediaType = mediaType(),
  onBuilt = vi.fn(),
  seed: { initialQuery?: string; initialOpen?: string; strict?: boolean; libraryCategory?: MediaType; underneath?: boolean } = {},
) {
  const { strict, underneath, ...props } = seed
  const tree = (
    <LayerStackProvider home={HOME}>
      {underneath && <CreateLayerUnderneath />}
      <SearchTab mediaType={type} onBuilt={onBuilt} {...props} />
      <StackProbe />
    </LayerStackProvider>
  )
  render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  return { onBuilt }
}

/** The Create layer the tab lives in, so a test can see it replaced rather than pushed over. */
function CreateLayerUnderneath() {
  const layerStack = useLayerStack()
  useEffect(() => {
    layerStack.push({ id: 'new-list', kind: 'new-list', tabLabel: () => 'New List', content: '/lists/new?mediaType=tv' })
  }, [])
  return null
}

const stackIds = () => JSON.parse(screen.getByTestId('stack-ids').textContent ?? '[]') as string[]

const pushedLayers = () => JSON.parse(screen.getByTestId('stack').textContent ?? '[]') as string[][]

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
      fireEvent.click(screen.getByRole('button', { name: 'Add List' }))
    })

    expect(api.createFromSource).toHaveBeenCalledWith({
      mediaType: 'tv',
      externalRef: 'show:2',
      title: 'Better Call Saul',
    })
    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('list-9'))
  })

  it('Preview pushes a Preview layer carrying the source and its options, and imports nothing', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    renderTab()

    await search()
    fireEvent.click(await screen.findByRole('button', { name: /Better Call Saul/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const top = pushedLayers().at(-1)
    expect(top?.[0]).toBe('preview')
    expect(top?.[1]).toBe(
      '/lists/preview?mediaType=tv&externalRef=show%3A2&title=Better+Call+Saul',
    )
    expect(api.createFromSource).not.toHaveBeenCalled()
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
      fireEvent.click(screen.getByRole('button', { name: 'Add List' }))
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

    expect(await screen.findByText('Nothing Found')).not.toBeNull()
    expect(screen.getByText('You sure it\'s a thing? Anyway, try to spell stuff differently, or create a list manually.')).not.toBeNull()
  })

  it('still searches a category whose API key is missing, because the curated library needs none', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({
      sources: [
        {
          externalRef: 'canonical:lists/mega/mcu.yaml',
          title: 'Marvel Cinematic Universe — Infinity Saga (Release Order)',
          detail: 'Canonical list',
          status: 'complete',
        },
      ],
    })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 23 })
    vi.mocked(api.createFromSource).mockResolvedValue({ id: 'list-3' } as never)
    const { onBuilt } = renderTab(mediaType({ key: 'mega', label: 'Mega', searchAvailable: false }))

    // The form is there, with no "needs a key" wall in front of it.
    expect(screen.queryByText(/needs a TMDB key/)).toBeNull()
    await search('marvel')

    fireEvent.click(await screen.findByRole('button', { name: /Marvel Cinematic Universe/ }))
    expect(document.querySelector('.q-star')).not.toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add List' }))
    })

    expect(api.createFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ externalRef: 'canonical:lists/mega/mcu.yaml' }),
    )
    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('list-3'))
  })

  it('says a search needs a key only when the search comes back with no curated match either, on the web pointing at .env', async () => {
    vi.mocked(api.searchSources).mockRejectedValue(
      new ApiError('Search is not available for TV Shows.', 409, 'search.unavailable'),
    )
    renderTab(mediaType({ searchAvailable: false }))

    await search()

    expect(await screen.findByText('Nothing found in List Vault, and search in TMDB needs an API key to work')).not.toBeNull()
    expect(screen.getByText(/\.env file/)).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull()
  })

  it('on desktop points at Settings, and Open Settings opens the Settings layer', async () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    vi.mocked(api.searchSources).mockRejectedValue(
      new ApiError('Search is not available for TV Shows.', 409, 'search.unavailable'),
    )
    renderTab(mediaType({ searchAvailable: false }))

    await search()

    expect(await screen.findByText(/Add your API key in Settings/)).not.toBeNull()
    const open = screen.getByRole('button', { name: 'Open Settings' }) as HTMLButtonElement
    expect(open.disabled).toBe(false)

    act(() => open.click())

    expect(screen.getByTestId('stack').textContent).toBe(JSON.stringify([['home', '/'], ['settings', '']]))
  })

  describe('when the community library cannot be reached', () => {
    it('names both problems when there is no key either, on the web pointing at .env', async () => {
      vi.mocked(api.searchSources).mockRejectedValue(
        new ApiError('needs a key and library down', 409, 'search.unavailableOffline'),
      )
      renderTab(mediaType({ searchAvailable: false }))

      await search('marvel')

      expect(await screen.findByText(/Can't search .+ right now/)).not.toBeNull()
      expect(screen.getAllByText(/List Vault/).length).toBeGreaterThan(0)
      expect(screen.getByText(/\.env file/)).not.toBeNull()
      // Not the key-only headline: that would send the user hunting for a key that is only half the story.
      expect(screen.queryByText('Nothing found in List Vault, and search in TMDB needs an API key to work')).toBeNull()
    })

    it('for a library-only category (Mega) blames only the connection: no key, no .env, no Settings', async () => {
      ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
      vi.mocked(api.searchSources).mockRejectedValue(
        new ApiError('library down', 409, 'search.unavailableOffline'),
      )
      renderTab(mediaType({ key: 'mega', label: 'Mega', searchAvailable: false, searchScope: 'library' }))

      await search('marvel')

      expect(await screen.findByText("Can't search Mega right now")).not.toBeNull()
      expect(screen.getByText(/only place for searching in Mega/)).not.toBeNull()
      expect(screen.queryByText(/API key/)).toBeNull()
      expect(screen.queryByText(/\.env/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull()
    })

    it('on desktop also points at Settings, with Open Settings live', async () => {
      ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
      vi.mocked(api.searchSources).mockRejectedValue(
        new ApiError('x', 409, 'search.unavailableOffline'),
      )
      renderTab(mediaType({ searchAvailable: false }))

      await search()

      expect(await screen.findByText(/add yours in Settings/)).not.toBeNull()
      expect((screen.getByRole('button', { name: 'Open Settings' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('still shows the results it did get, with a strip saying curated lists are missing', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS, libraryUnreachable: true })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      renderTab()

      await search()

      expect(await screen.findByText('Breaking Bad')).not.toBeNull()
      expect(screen.getByRole('alert').textContent).toMatch(/List Vault/)
    })

    it('Retry on that strip searches again', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce({ sources: RESULTS, libraryUnreachable: true })
        .mockResolvedValueOnce({ sources: RESULTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      renderTab()

      await search()
      await screen.findByRole('alert')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      })

      await waitFor(() => expect(api.searchSources).toHaveBeenCalledTimes(2))
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('an empty search says nothing was found and that curated lists were not searched', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: [], libraryUnreachable: true })
      renderTab()

      await search('zzzz')

      expect(await screen.findByText('Nothing Found')).not.toBeNull()
      expect(screen.getAllByText(/List Vault/).length).toBeGreaterThan(0)
    })

    it('says nothing about the library when it was reachable', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: RESULTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      renderTab()

      await search()
      await screen.findByText('Breaking Bad')

      expect(screen.queryByRole('alert')).toBeNull()
    })
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
      fireEvent.click(screen.getByRole('button', { name: 'Add List' }))
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
        fireEvent.click(screen.getByRole('button', { name: 'Live' }))
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
      expect(screen.queryByRole('button', { name: 'Live' })).toBeNull()
    })
  })

  it('turns off spellcheck, autocorrect and autocapitalise on the query: it is a name, not prose', () => {
    renderTab()

    const input = screen.getByLabelText(/^Search /) as HTMLInputElement
    // macOS' WKWebView otherwise underlines "Cannibal Corpse" and offers grammar fixes.
    // (jsdom has no `spellcheck` property, so read the attribute React renders.)
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('off')
    expect(input.getAttribute('autocomplete')).toBe('off')
  })

  describe('opened already searched (Open in Mega, task 14.1)', () => {
    const MEGA = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })
    const LISTS: ListSourceResult[] = [
      { externalRef: 'canonical:lists/mega/breaking-bad-main-watch.yaml', title: 'Breaking Bad franchise - main list', detail: 'Canonical list' },
      { externalRef: 'canonical:lists/mega/breaking-bad-all.yaml', title: 'Breaking Bad franchise - full list', detail: 'Canonical list' },
    ]
    const rowOf = (title: string) => screen.getByRole('button', { name: new RegExp(title) })

    it('runs the search it was given on opening, shows the query in the field, and lists the results', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })

      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialQuery: 'breaking bad' })
      })

      expect(api.searchSources).toHaveBeenCalledExactlyOnceWith('mega', 'breaking bad', undefined)
      expect((screen.getByLabelText(/^Search /) as HTMLInputElement).value).toBe('breaking bad')
      expect(screen.getByText('Breaking Bad franchise - main list')).toBeTruthy()
    })

    it('opens the result it was asked to, and only that one', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })

      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialQuery: 'breaking bad', initialOpen: 'canonical:lists/mega/breaking-bad-all.yaml' })
      })

      expect(rowOf('full list').getAttribute('aria-expanded')).toBe('true')
      expect(rowOf('main list').getAttribute('aria-expanded')).toBe('false')
    })

    it('opens nothing, and does not fail, when the result it was asked to open is not in the results', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })

      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialQuery: 'breaking bad', initialOpen: 'canonical:lists/mega/gone.yaml' })
      })

      expect(rowOf('full list').getAttribute('aria-expanded')).toBe('false')
      expect(rowOf('main list').getAttribute('aria-expanded')).toBe('false')
    })

    it('does not search at all when it was given no query, even with a result to open', async () => {
      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialOpen: 'canonical:lists/mega/breaking-bad-all.yaml' })
      })

      expect(api.searchSources).not.toHaveBeenCalled()
      expect((screen.getByLabelText(/^Search /) as HTMLInputElement).value).toBe('')
    })

    it('searches once even where React mounts twice (StrictMode)', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })

      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialQuery: 'breaking bad', initialOpen: 'canonical:lists/mega/breaking-bad-all.yaml', strict: true })
      })

      expect(api.searchSources).toHaveBeenCalledTimes(1)
      expect(rowOf('full list').getAttribute('aria-expanded')).toBe('true')
    })

    it('does not reopen it on the next search the user makes themselves', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: LISTS })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      await act(async () => {
        renderTab(MEGA, vi.fn(), { initialQuery: 'breaking bad', initialOpen: 'canonical:lists/mega/breaking-bad-all.yaml' })
      })

      await search('breaking')

      expect(api.searchSources).toHaveBeenCalledTimes(2)
      expect(rowOf('full list').getAttribute('aria-expanded')).toBe('false')
    })
  })

  describe('the Fuller lists in Mega hint (task 14.2)', () => {
    const MEGA = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })
    const MEGA_LISTS: ListSourceResult[] = [
      { externalRef: 'canonical:lists/mega/bb-main.yaml', title: 'Breaking Bad franchise - main list', detail: 'Canonical list', description: 'The recommended order', itemCount: 126 },
      { externalRef: 'canonical:lists/mega/bb-all.yaml', title: 'Breaking Bad franchise - full list', detail: 'Canonical list', description: 'Every release', itemCount: 197 },
    ]
    const hintRow = () => screen.getByRole('button', { name: /Show details for Fuller list/ })

    function answerWith(mega: ListSourceResult[] | Error | 'unreachable' = MEGA_LISTS) {
      vi.mocked(api.searchSources).mockImplementation(async (key) => {
        if (key !== 'mega') return { sources: RESULTS }
        if (mega instanceof Error) throw mega
        if (mega === 'unreachable') return { sources: [], libraryUnreachable: true }
        return { sources: mega }
      })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    }

    it('asks the library-scope category for the same search, beside the category’s own, and shows the row first', async () => {
      answerWith()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

      await search('breaking bad')

      expect(api.searchSources).toHaveBeenCalledWith('tv', 'breaking bad', undefined)
      expect(api.searchSources).toHaveBeenCalledWith('mega', 'breaking bad')
      const rows = screen.getAllByRole('button', { name: /Show details for/ })
      expect(rows[0]).toBe(hintRow())
      expect(rows).toHaveLength(3)
    })

    it('counts the category’s results and Mega’s lists together in the header', async () => {
      answerWith()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

      await search('breaking bad')

      expect(screen.getByText('4 results')).toBeTruthy()
    })

    it('opens in place, naming the lists, and does not leave the category', async () => {
      answerWith()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA, underneath: true })
      await search('breaking bad')

      fireEvent.click(hintRow())

      expect(hintRow().getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText('The recommended order · 126 items')).toBeTruthy()
      expect(pushedLayers().map(([kind]) => kind)).toEqual(['home', 'new-list'])
      expect(pushedLayers()[1]![1]).toBe('/lists/new?mediaType=tv')
    })

    it('Open replaces this Create layer with Mega’s: query kept, that list open, the stack no deeper, a layer of its own', async () => {
      answerWith()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA, underneath: true })
      await search('breaking bad')
      fireEvent.click(hintRow())

      fireEvent.click(screen.getByRole('button', { name: 'Open Breaking Bad franchise - full list' }))

      expect(pushedLayers()).toEqual([
        ['home', '/'],
        ['new-list', '/lists/new?mediaType=mega&q=breaking+bad&open=canonical%3Alists%2Fmega%2Fbb-all.yaml'],
      ])
      expect(stackIds()).toEqual(['home', 'new-list-mega'])
    })

    it('See all N in Mega opens Mega with the query and no list open', async () => {
      const five = Array.from({ length: 5 }, (_, n) => ({ externalRef: `canonical:lists/mega/l${n}.yaml`, title: `Breaking Bad list ${n}`, detail: 'Canonical list' }))
      answerWith(five)
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA, underneath: true })
      await search('breaking bad')
      fireEvent.click(hintRow())

      fireEvent.click(screen.getByRole('button', { name: 'See all 5 in Mega' }))

      expect(pushedLayers()[1]).toEqual(['new-list', '/lists/new?mediaType=mega&q=breaking+bad'])
    })

    it('shows no row, and the header counts only the category’s results, when no Mega list matches', async () => {
      answerWith([])
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

      await search('saul')

      expect(screen.queryByText(/Fuller list/)).toBeNull()
      expect(screen.getByText('2 results')).toBeTruthy()
    })

    it('shows no row, and no error, when the Mega lookup fails or the library cannot be reached', async () => {
      for (const failure of [new Error('offline'), 'unreachable'] as const) {
        answerWith(failure)
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

        await search('breaking bad')

        expect(screen.queryByText(/Fuller list/)).toBeNull()
        expect(screen.getByText('2 results')).toBeTruthy()
        expect(screen.queryByRole('alert')).toBeNull()
        cleanup()
      }
    })

    it('makes no second search when the tab has no library category (it is Mega itself, or the registry has none)', async () => {
      answerWith()
      renderTab(mediaType(), vi.fn())

      await search('breaking bad')

      expect(api.searchSources).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/Fuller list/)).toBeNull()
    })
  })
})

