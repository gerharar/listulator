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
    expect(screen.getByText('You sure it\'s a thing? Anyway, try to spell stuff differently, or create a list manually')).not.toBeNull()
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

  describe('the search field label', () => {
    it('names the source and the library for a category that searches both', () => {
      renderTab(mediaType({ sourceName: 'TMDB' }))
      expect(screen.getByLabelText('Search TMDB or List Vault')).toBeTruthy()
    })

    it('names the library once for a library-only category (Mega), not "List Vault or List Vault"', () => {
      renderTab(mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' }))
      expect(screen.getByLabelText('Search List Vault')).toBeTruthy()
    })
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
    const hintRow = () => screen.getByRole('button', { name: /Show details for Your Princess/ })

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

      expect(screen.queryByText(/Your Princess/)).toBeNull()
      expect(screen.getByText('2 results')).toBeTruthy()
    })

    it('shows no row, and no error, when the Mega lookup fails or the library cannot be reached', async () => {
      for (const failure of [new Error('offline'), 'unreachable'] as const) {
        answerWith(failure)
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

        await search('breaking bad')

        expect(screen.queryByText(/Your Princess/)).toBeNull()
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
      expect(screen.queryByText(/Your Princess/)).toBeNull()
    })
  })

  describe('where the hint must not show, and the empty search (task 14.3)', () => {
    const MEGA = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })
    const BLACK_MIRROR: ListSourceResult = {
      externalRef: 'canonical:lists/mega/black-mirror.yaml',
      title: 'Black Mirror franchise (release order)',
      detail: 'Canonical list',
      itemCount: 41,
    }
    type Answer = { sources: ListSourceResult[]; libraryUnreachable?: boolean }
    const hintRow = () => screen.queryByRole('button', { name: /Show details for Your Princess/ })

    /** One search at a time, answered by hand: what each category returns for each query, and when. */
    function gates() {
      const open: Record<string, (value: Answer) => void> = {}
      vi.mocked(api.searchSources).mockImplementation(
        (key, query) =>
          new Promise((resolve) => {
            open[`${key}:${query}`] = resolve
          }),
      )
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })

      return open
    }

    function answer(tv: Answer | Error, mega: ListSourceResult[] = [BLACK_MIRROR]) {
      vi.mocked(api.searchSources).mockImplementation(async (key) => {
        if (key === 'mega') return { sources: mega }
        if (tv instanceof Error) throw tv
        return tv
      })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    }

    it('shows nothing, hint or results, until both searches have answered, and then both at once', async () => {
      const open = gates()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })
      await search('black mirror')

      await act(async () => open['tv:black mirror']!({ sources: RESULTS }))
      expect(hintRow()).toBeNull()
      expect(screen.queryByText(RESULTS[0]!.title)).toBeNull()
      expect(screen.getByText('Searching…')).toBeTruthy()

      await act(async () => open['mega:black mirror']!({ sources: [BLACK_MIRROR] }))
      expect(hintRow()).not.toBeNull()
      expect(screen.getByText(RESULTS[0]!.title)).toBeTruthy()
    })

    it('drops the last search’s hint the moment a new search starts', async () => {
      answer({ sources: RESULTS })
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })
      await search('black mirror')
      expect(hintRow()).not.toBeNull()

      gates()
      await search('saul')

      expect(hintRow()).toBeNull()
    })

    it('never shows an older search’s hint when a newer search has answered first', async () => {
      const open = gates()
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })
      await search('black mirror')
      await search('saul')

      await act(async () => {
        open['tv:saul']!({ sources: RESULTS })
        open['mega:saul']!({ sources: [] })
      })
      await act(async () => {
        open['tv:black mirror']!({ sources: [] })
        open['mega:black mirror']!({ sources: [BLACK_MIRROR] })
      })

      expect(hintRow()).toBeNull()
      expect(screen.getByText('2 results')).toBeTruthy()
    })

    it('shows no row when the category’s own search fails, even though Mega has the list', async () => {
      answer(new Error('TMDB is down'))
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

      await search('black mirror')

      expect(await screen.findByText('TMDB is down')).toBeTruthy()
      expect(hintRow()).toBeNull()
    })

    it('shows no row in the no-key notice either', async () => {
      answer(new ApiError('Search is not available for TV Shows.', 409, 'search.unavailable'))
      renderTab(mediaType({ searchAvailable: false }), vi.fn(), { libraryCategory: MEGA })

      await search('black mirror')

      expect(await screen.findByText(/needs an API key to work/)).toBeTruthy()
      expect(hintRow()).toBeNull()
    })

    describe('when the category has nothing but Mega has the list', () => {
      it('shows the row alone, counted as one result, in place of Nothing Found', async () => {
        answer({ sources: [] })
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

        await search('black mirror')

        expect(hintRow()).not.toBeNull()
        expect(screen.getAllByRole('button', { name: /Show details for/ })).toHaveLength(1)
        expect(screen.getByText('1 result')).toBeTruthy()
        expect(screen.queryByText('Nothing Found')).toBeNull()
        expect(screen.queryByRole('alert')).toBeNull()
      })

      it('counts every Mega list, even though only two are named', async () => {
        const five = Array.from({ length: 5 }, (_, n) => ({ externalRef: `canonical:lists/mega/f${n}.yaml`, title: `Franchise ${n}`, detail: 'Canonical list' }))
        answer({ sources: [] }, five)
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

        await search('franchise')

        expect(screen.getByText('5 results')).toBeTruthy()
      })

      it('opens in place and leaves from Open, like the row above results', async () => {
        answer({ sources: [] })
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA, underneath: true })
        await search('black mirror')

        fireEvent.click(hintRow()!)
        fireEvent.click(screen.getByRole('button', { name: 'Open Black Mirror franchise (release order)' }))

        expect(pushedLayers()[1]![1]).toBe('/lists/new?mediaType=mega&q=black+mirror&open=canonical%3Alists%2Fmega%2Fblack-mirror.yaml')
      })

      it('still says the curated lists could not be searched, with Retry, when that is what happened', async () => {
        answer({ sources: [], libraryUnreachable: true })
        renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

        await search('black mirror')

        expect(hintRow()).not.toBeNull()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      })
    })

    it('says Nothing Found as before when neither the category nor Mega has anything', async () => {
      answer({ sources: [] }, [])
      renderTab(mediaType(), vi.fn(), { libraryCategory: MEGA })

      await search('zzzz')

      expect(await screen.findByText('Nothing Found')).toBeTruthy()
      expect(hintRow()).toBeNull()
    })
  })

  describe('more matches than the rows shown (design search-show-more, 5A)', () => {
    const COMIC = mediaType({ key: 'comic', label: 'Comics', sourceName: 'Comic Vine' })
    const volume = (n: number): ListSourceResult => ({ externalRef: `volume:${n}`, title: `Batman (${1900 + n})`, detail: `${n} issues`, itemCount: n })
    const volumes = (from: number, count: number): ListSourceResult[] => Array.from({ length: count }, (_, index) => volume(from + index))
    const rows = () => screen.queryAllByRole('button', { name: /Show details for/ })
    const stop = () => screen.queryByText(/^End of first/)

    const firstPage = { sources: volumes(1, 20), hasMore: true, total: 52, totalIsLowerBound: true }

    it('shows "20 of 52+ results" and closes the list with the stop, after the last row', async () => {
      vi.mocked(api.searchSources).mockResolvedValue(firstPage)
      renderTab(COMIC)

      await search('batman')

      expect(await screen.findByText('20 of 52+ results')).not.toBeNull()
      expect(rows()).toHaveLength(20)
      expect(screen.getByText('End of first 20')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Refine search' })).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Show more' })).not.toBeNull()
      // After the last row, not before it.
      const last = rows().at(-1)!
      expect(last.compareDocumentPosition(screen.getByText('End of first 20')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('says "of 52" without the plus when the total is exact', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ ...firstPage, totalIsLowerBound: undefined })
      renderTab(COMIC)

      await search('batman')

      expect(await screen.findByText('20 of 52 results')).not.toBeNull()
    })

    it('keeps today’s "N results" and shows no stop when nothing is cut off', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: volumes(1, 3), total: 3 })
      renderTab(COMIC)

      await search('batman')

      expect(await screen.findByText('3 results')).not.toBeNull()
      expect(stop()).toBeNull()
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    })

    it('shows no stop in the empty state or the error state, or while the search is running', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce({ sources: [], hasMore: true })
      renderTab(COMIC)
      await search('nothing')
      expect(stop()).toBeNull()

      vi.mocked(api.searchSources).mockRejectedValueOnce(new Error('down'))
      await search('boom')
      expect(stop()).toBeNull()

      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage)
      await search('batman')
      expect(stop()).not.toBeNull()
      vi.mocked(api.searchSources).mockImplementationOnce(() => new Promise(() => {}))
      await search('again')
      expect(stop()).toBeNull()
    })

    it('does not count the Mega hint row in the shown rows when the list is cut off', async () => {
      const MEGA = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })
      vi.mocked(api.searchSources).mockImplementation(async (key) =>
        key === 'mega'
          ? { sources: [{ externalRef: 'canonical:lists/mega/b.yaml', title: 'Batman franchise', itemCount: 90 }] }
          : firstPage,
      )
      renderTab(COMIC, vi.fn(), { libraryCategory: MEGA })

      await search('batman')

      expect(await screen.findByText('20 of 52+ results')).not.toBeNull()
      expect(screen.getByText('End of first 20')).not.toBeNull()
    })

    it('Show more asks for the next page of the query that was searched and puts its rows under the ones above', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ sources: volumes(21, 20), hasMore: true, total: 52, totalIsLowerBound: true })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')

      // The field is edited after the search; Show more still continues the search that was made.
      fireEvent.change(screen.getByLabelText(/^Search /), { target: { value: 'something else' } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(api.searchSources).toHaveBeenLastCalledWith('comic', 'batman', { page: 2 })
      expect(rows()).toHaveLength(40)
      expect(rows()[19]!.textContent).toContain('Batman (1920)')
      expect(rows()[20]!.textContent).toContain('Batman (1921)')
      expect(screen.getByText('40 of 52+ results')).not.toBeNull()
      expect(screen.getByText('End of first 40')).not.toBeNull()
    })

    it('goes on offering Show more while there is more, and takes the stop away with the last page', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce({ sources: volumes(21, 20), hasMore: true, total: 52, totalIsLowerBound: true })
        .mockResolvedValueOnce({ sources: volumes(41, 12), total: 52 })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')

      for (const call of [2, 3]) {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
        })
        expect(api.searchSources).toHaveBeenLastCalledWith('comic', 'batman', { page: call })
      }

      expect(rows()).toHaveLength(52)
      expect(stop()).toBeNull()
      expect(screen.getByText('52 results')).not.toBeNull()
    })

    it('leaves rows that are open open, and the count of a row above untouched, when more rows arrive', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ sources: volumes(21, 20), hasMore: true, total: 52 })
      renderTab(COMIC)
      await search('batman')
      fireEvent.click(await screen.findByRole('button', { name: /Show details for Batman \(1901\)/ }))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(screen.getByRole('button', { name: /Show details for Batman \(1901\)/ }).getAttribute('aria-expanded')).toBe('true')
    })

    it('does not show a row twice if the next page repeats one', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ sources: [volume(20), ...volumes(21, 3)], total: 52 })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(rows()).toHaveLength(23)
    })

    it('locks Show more while the next rows load, and asks only once however often it is pressed', async () => {
      let release: (value: { sources: ListSourceResult[] }) => void = () => {}
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })
      const loading = screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement
      fireEvent.click(loading)

      expect(loading.disabled).toBe(true)
      expect(api.searchSources).toHaveBeenCalledTimes(2)
      await act(async () => release({ sources: volumes(21, 2) }))
      expect(rows()).toHaveLength(22)
    })

    it('keeps the rows and shows the soft error strip when the next page fails, and Retry asks again', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce({ sources: volumes(21, 5), total: 25 })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(rows()).toHaveLength(20)
      expect(screen.getByRole('alert')).not.toBeNull()
      expect((screen.getByRole('button', { name: 'Show more' }) as HTMLButtonElement).disabled).toBe(false)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
      })
      expect(rows()).toHaveLength(25)
      expect(api.searchSources).toHaveBeenLastCalledWith('comic', 'batman', { page: 2 })
    })

    it('drops a late next page once a new search has been made', async () => {
      let release: (value: { sources: ListSourceResult[] }) => void = () => {}
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
        .mockResolvedValueOnce({ sources: [{ externalRef: 'volume:99', title: 'Superman (1938)', itemCount: 5 }] })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      await search('superman')
      await act(async () => release({ sources: volumes(21, 20) }))

      expect(rows()).toHaveLength(1)
      expect(screen.getByText('Superman (1938)')).not.toBeNull()
    })

    it('sends the book options with the page, as the first search did', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ sources: volumes(21, 2) })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
      renderTab(mediaType({ key: 'book', label: 'Books', sourceName: 'Open Library' }))
      fireEvent.click(screen.getByRole('button', { name: 'English' }))
      await search('batman')
      await screen.findByText('20 of 52+ results')

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(api.searchSources).toHaveBeenLastCalledWith('book', 'batman', { language: 'eng', includeUnknown: false, page: 2 })
    })

    it('shows a count the search answer carries, and asks for none for that row', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: [volume(716), volume(0)], total: 2 })
      renderTab(COMIC)

      await search('batman')

      expect(await screen.findByText('716')).not.toBeNull()
      expect(screen.getByText('0')).not.toBeNull()
      expect(api.expansion).not.toHaveBeenCalled()
    })

    it('asks for the count of a row whose answer carries none, and of a curated list even when the index gives one', async () => {
      const curated: ListSourceResult = { externalRef: 'canonical:lists/comic/b.yaml', title: 'Curated Batman', itemCount: 90 }
      vi.mocked(api.searchSources).mockResolvedValue({ sources: [curated, volume(5), { externalRef: 'volume:6', title: 'Batman (1906)' }], total: 3 })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 42 })
      renderTab(COMIC)

      await search('batman')

      await waitFor(() => expect(api.expansion).toHaveBeenCalledTimes(2))
      expect(vi.mocked(api.expansion).mock.calls.map((call) => call[1]).sort()).toEqual(['canonical:lists/comic/b.yaml', 'volume:6'])
    })

    it('asks for the counts of new rows without seeded ones, and not again for rows already counted', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce({ sources: [{ externalRef: 'volume:1', title: 'Batman (1901)' }], hasMore: true, total: 3 })
        .mockResolvedValueOnce({ sources: [volume(2), { externalRef: 'volume:3', title: 'Batman (1903)' }], total: 3 })
      vi.mocked(api.expansion).mockResolvedValue({ itemCount: 7 })
      renderTab(COMIC)
      await search('batman')
      await waitFor(() => expect(api.expansion).toHaveBeenCalledTimes(1))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      await waitFor(() => expect(api.expansion).toHaveBeenCalledTimes(2))
      expect(vi.mocked(api.expansion).mock.calls.map((call) => call[1])).toEqual(['volume:1', 'volume:3'])
    })

    it('asks only once when Show more is pressed twice before the page has re-rendered', async () => {
      vi.mocked(api.searchSources).mockResolvedValueOnce(firstPage).mockImplementationOnce(() => new Promise(() => {}))
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      const button = screen.getByRole('button', { name: 'Show more' })

      await act(async () => {
        fireEvent.click(button)
        fireEvent.click(button)
      })

      expect(api.searchSources).toHaveBeenCalledTimes(2)
    })

    it('shows no stop under a Mega hint alone, whatever the empty category search says about more', async () => {
      const MEGA = mediaType({ key: 'mega', label: 'Mega', sourceName: undefined, searchScope: 'library' })
      vi.mocked(api.searchSources).mockImplementation(async (key) =>
        key === 'mega'
          ? { sources: [{ externalRef: 'canonical:lists/mega/b.yaml', title: 'Batman franchise', itemCount: 90 }] }
          : { sources: [], hasMore: true, total: 30 },
      )
      renderTab(COMIC, vi.fn(), { libraryCategory: MEGA })

      await search('batman')

      expect(await screen.findByRole('button', { name: /Show details for Your Princess/ })).not.toBeNull()
      expect(stop()).toBeNull()
    })

    it('says "of 20+" when the source has more but cannot say how many', async () => {
      vi.mocked(api.searchSources).mockResolvedValue({ sources: volumes(1, 20), hasMore: true })
      renderTab(COMIC)

      await search('batman')

      expect(await screen.findByText('20 of 20+ results')).not.toBeNull()
    })

    it('starts again at the second page on a new search, not where the last one left off', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce({ sources: volumes(21, 20), hasMore: true, total: 52 })
        .mockResolvedValueOnce({ sources: volumes(100, 20), hasMore: true, total: 60 })
        .mockResolvedValueOnce({ sources: volumes(120, 5), total: 60 })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      await search('superman')
      await screen.findByText('20 of 60 results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(api.searchSources).toHaveBeenLastCalledWith('comic', 'superman', { page: 2 })
    })

    it('can show more after a new search was made while the last Show more was still waiting', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce({ sources: volumes(100, 20), hasMore: true, total: 60 })
        .mockResolvedValueOnce({ sources: volumes(120, 5), total: 60 })
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      await search('superman')
      await screen.findByText('20 of 60 results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(rows()).toHaveLength(25)
    })

    it('takes the error strip away when Show more is pressed again', async () => {
      vi.mocked(api.searchSources)
        .mockResolvedValueOnce(firstPage)
        .mockRejectedValueOnce(new Error('down'))
        .mockImplementationOnce(() => new Promise(() => {}))
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })
      expect(screen.getByRole('alert')).not.toBeNull()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      })

      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('locks Show more and Refine while the tab is adding a list', async () => {
      vi.mocked(api.searchSources).mockResolvedValue(firstPage)
      vi.mocked(api.createFromSource).mockImplementation(() => new Promise(() => {}))
      renderTab(COMIC)
      await search('batman')
      await screen.findByText('20 of 52+ results')
      fireEvent.click(rows()[0]!)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Add List' }))
      })

      expect((screen.getByRole('button', { name: 'Show more' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'Refine search' }) as HTMLButtonElement).disabled).toBe(true)
    })

    describe('Refine search', () => {
      it('focuses the query and selects its text, and leaves the results where they are', async () => {
        vi.mocked(api.searchSources).mockResolvedValue(firstPage)
        renderTab(COMIC)
        await search('batman')
        await screen.findByText('20 of 52+ results')

        fireEvent.click(screen.getByRole('button', { name: 'Refine search' }))

        const input = screen.getByLabelText(/^Search /) as HTMLInputElement
        expect(document.activeElement).toBe(input)
        expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'batman'.length])
        expect(rows()).toHaveLength(20)
      })

      it.each(['auto', 'scroll'])('brings the field into view by the scroll container’s own scrollTop (overflow %s), never scrollIntoView', async (overflow) => {
        const scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView
        vi.mocked(api.searchSources).mockResolvedValue(firstPage)
        renderTab(COMIC)
        await search('batman')
        await screen.findByText('20 of 52+ results')
        const input = screen.getByLabelText(/^Search /) as HTMLInputElement
        // The tab's parent stands for the layer body that scrolls.
        const scroller = input.closest('.q-search')!.parentElement as HTMLElement
        scroller.style.overflowY = overflow
        scroller.scrollTop = 300
        scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
        input.getBoundingClientRect = () => ({ top: 30 }) as DOMRect

        fireEvent.click(screen.getByRole('button', { name: 'Refine search' }))

        expect(scroller.scrollTop).toBe(230)
        expect(scrollIntoView).not.toHaveBeenCalled()
      })
    })
  })
})
