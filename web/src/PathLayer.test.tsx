// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { api, type MediaType } from './lib/api.js'
import { PathLayer } from './App.js'
import { LayerStackProvider } from './components/quantum/layerStack/LayerStackContext.js'
import { OverlayManagerProvider } from './components/quantum/overlay/OverlayManagerContext.js'
import { newListPath } from './components/quantum/layerStack/layerPath.js'

vi.mock('./lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/api.js')>()),
  api: {
    searchSources: vi.fn(),
    createFromSource: vi.fn(),
    expansion: vi.fn(),
    createList: vi.fn(),
    importItems: vi.fn(),
    createFromFile: vi.fn(),
  },
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const base = { sortOrder: 10, defaultDurationMinutes: 30, searchAvailable: true, previewable: true }
const TV: MediaType = { ...base, key: 'tv', label: 'TV Shows', sourceName: 'TMDB' }
const MEGA: MediaType = { ...base, key: 'mega', label: 'Mega', searchScope: 'library' }
const HOME = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

function layer(path: string) {
  return (
    <OverlayManagerProvider>
      <LayerStackProvider home={HOME}>
        <PathLayer path={path} mediaTypes={[TV, MEGA]} />
      </LayerStackProvider>
    </OverlayManagerProvider>
  )
}

const field = () => screen.getByLabelText(/^Search /) as HTMLInputElement

describe('the Create layer named by a path', () => {
  it('opens a category already searched when its path carries a query and a result to open', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({
      sources: [{ externalRef: 'canonical:lists/mega/a.yaml', title: 'Breaking Bad franchise', detail: 'Canonical list' }],
    })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 3 })

    await act(async () => {
      render(layer(newListPath({ mediaType: 'mega', query: 'breaking bad', openRef: 'canonical:lists/mega/a.yaml' })))
    })

    expect(api.searchSources).toHaveBeenCalledExactlyOnceWith('mega', 'breaking bad', undefined)
    expect(field().value).toBe('breaking bad')
    expect(screen.getByRole('button', { name: /Breaking Bad franchise/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('starts afresh when the layer is replaced by another path: the old category’s query and results do not carry over', async () => {
    vi.mocked(api.searchSources).mockResolvedValue({ sources: [{ externalRef: 'show:1', title: 'Breaking Bad', detail: 'TV' }] })
    vi.mocked(api.expansion).mockResolvedValue({ itemCount: 1 })
    const { rerender } = render(layer(newListPath({ mediaType: 'tv' })))
    fireEvent.change(field(), { target: { value: 'something typed in TV' } })
    expect(field().value).toBe('something typed in TV')

    vi.mocked(api.searchSources).mockResolvedValue({
      sources: [{ externalRef: 'canonical:lists/mega/a.yaml', title: 'Breaking Bad franchise', detail: 'Canonical list' }],
    })
    await act(async () => {
      rerender(layer(newListPath({ mediaType: 'mega', query: 'breaking bad' })))
    })

    expect(field().value).toBe('breaking bad')
    expect(screen.queryByText('Breaking Bad', { exact: true })).toBeNull()
    expect(screen.getByText('Breaking Bad franchise')).toBeTruthy()
  })
})
