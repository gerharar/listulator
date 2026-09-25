// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { MediaType } from '../../../lib/api.js'
import { LayerStackProvider } from '../layerStack/LayerStackContext.js'
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

function renderCreate(key: string, mediaTypes: MediaType[] = [TV, MEGA, PODCAST]) {
  const home = { id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }

  return render(
    <LayerStackProvider home={home}>
      <CreateList mediaTypes={mediaTypes} mediaTypeKey={key} />
    </LayerStackProvider>,
  )
}

const tabs = () => screen.getAllByRole('tab').map((tab) => tab.textContent)

describe('CreateList', () => {
  it("titles the layer with the category's display label, not the registry's", () => {
    renderCreate('tv')

    expect(screen.getByRole('heading', { name: 'New TV Series list' })).not.toBeNull()
  })

  it("shows the category's own description under the title when it has one", () => {
    renderCreate('mega')

    expect(screen.getByText('Franchises that span several media at once.')).not.toBeNull()
  })

  it('offers Search {source}, Add by hand and Import a file, starting on Search', () => {
    renderCreate('tv')

    expect(tabs()).toEqual(['Search TMDB', 'Add by hand', 'Import a file'])
    expect(screen.getByRole('tab', { name: 'Search TMDB' }).getAttribute('aria-selected')).toBe(
      'true',
    )
  })

  it("leaves Search out for a category with no search source, and starts on Add by hand", () => {
    renderCreate('podcast')

    expect(tabs()).toEqual(['Add by hand', 'Import a file'])
    expect(screen.getByRole('tab', { name: 'Add by hand' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByLabelText('List title')).not.toBeNull()
  })

  it('keeps the Search tab for a category whose search needs a key, so it can say so', () => {
    const keyed = mediaType({ key: 'tv', label: 'TV Shows', searchAvailable: false })

    renderCreate('tv', [keyed])

    expect(tabs()).toContain('Search TMDB')
  })

  it('shows the by-hand form on its tab and the file import on the other', () => {
    renderCreate('tv')

    fireEvent.click(screen.getByRole('tab', { name: 'Add by hand' }))
    expect(screen.getByLabelText('List title')).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Import a file' }))
    expect(screen.getByRole('button', { name: 'Import' })).not.toBeNull()
    expect(screen.queryByLabelText('List title')).toBeNull()
  })

  it('clears a tab\'s transient state when you leave it', () => {
    renderCreate('tv')

    fireEvent.click(screen.getByRole('tab', { name: 'Add by hand' }))
    fireEvent.change(screen.getByLabelText('List title'), { target: { value: 'Half typed' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Import a file' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Add by hand' }))

    expect((screen.getByLabelText('List title') as HTMLInputElement).value).toBe('')
  })

  it('falls back to the first category rather than crashing on a key the registry lacks', () => {
    renderCreate('gone', [TV])

    expect(screen.getByRole('heading', { name: 'New TV Series list' })).not.toBeNull()
  })
})
