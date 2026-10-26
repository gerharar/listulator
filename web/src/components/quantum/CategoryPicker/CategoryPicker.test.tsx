// @vitest-environment jsdom
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MediaList, MediaType } from '../../../lib/api.js'
import type { KeySource } from '../../../lib/config/keyTest.js'
import { api } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ToastProvider } from '../Toast/Toast.js'
import { useRefetchOnRegistryChange } from '../../../lib/registryChanges.js'
import { updateLocalSettings } from '../../../lib/config/localConfig.js'
import { notifyListsChanged } from '../../../lib/listsChanged.js'
import { CategoryPicker } from './CategoryPicker.js'

vi.mock('../../../lib/api.js', () => ({
  api: {
    lists: vi.fn(),
    libraryUntracked: vi.fn(async () => ({ entries: [], reachable: true })),
  },
}))
// Saving a key (the key card) writes the desktop's settings and rebuilds its registry; here both are stand-ins.
vi.mock('../../../lib/config/localConfig.js', () => ({ getLocalSettings: vi.fn(), updateLocalSettings: vi.fn(async () => {}) }))
vi.mock('../../../lib/ingestion/localMediaTypes.js', () => ({ resetLocalMediaTypes: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** The registry names the key a source takes; a fixture gets it from the source it names, as the real registry does. */
const KEY_SOURCE_OF: Readonly<Record<string, KeySource>> = { TMDB: 'tmdb', IGDB: 'igdb', 'Comic Vine': 'comicVine', YouTube: 'youtube' }

function withKeySource(type: MediaType): MediaType {
  const keySource = type.sourceName ? KEY_SOURCE_OF[type.sourceName] : undefined

  return keySource ? { ...type, keySource } : type
}

function mediaType(overrides: Partial<MediaType> & Pick<MediaType, 'key' | 'label'>): MediaType {
  return withKeySource({
    sortOrder: 10,
    defaultDurationMinutes: 30,
    searchAvailable: true,
    previewable: true,
    sourceName: 'TMDB',
    ...overrides,
  })
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
  it('renders one tile per registry entry, A–Z by the display label from the locale', async () => {
    vi.mocked(api.lists).mockResolvedValue([])

    renderPicker(REGISTRY)

    expect(tiles().map((tile) => within(tile).getByText(/./, { selector: 'b' }).textContent)).toEqual([
      'Movies',
      'Pro Wrestling',
      // The registry says "TV Shows"; the locale's display label wins (C1), and it is what sorts.
      'TV Series',
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

  it('a library-only category’s footer names the community library (F9)', async () => {
    vi.mocked(api.lists).mockResolvedValue([])
    const mega = mediaType({ key: 'mega', label: 'Mega', sortOrder: 100, sourceName: undefined, searchScope: 'library' })

    renderPicker([...REGISTRY, mega])

    const tile = tiles().find((entry) => within(entry).queryByText('Mega'))!
    expect(tile.querySelector('.q-tile-src')?.textContent).toBe('List Vault')
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
    expect(tiles()[1]!.classList.contains('used')).toBe(false) // Pro Wrestling, between Movies and TV Series
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

    expect(screen.getByRole('heading', { name: 'No Progress Tracked. Let\'s Start!' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(document.querySelectorAll('.q-count-chip')).toHaveLength(0)
    expect(api.lists).not.toHaveBeenCalled()
  })

  it('has a close button when reached from Home, and it pops the picker', async () => {
    vi.mocked(api.lists).mockResolvedValue([])

    renderPicker(REGISTRY)
    expect(screen.getByTestId('stack').textContent).toBe('home:/,category-picker:/')

    expect(screen.getByRole('heading', { name: 'Choose Your Fighter' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('stack').textContent).toBe('home:/')
  })
})

describe('the “Free key needed” chip (H-018, 33.1)', () => {
  const KEYLESS: MediaType[] = [
    mediaType({ key: 'movie', label: 'Movies', sortOrder: 10, searchAvailable: false }),
    mediaType({ key: 'tv', label: 'TV Shows', sortOrder: 20, searchAvailable: true }),
    mediaType({ key: 'mega', label: 'Mega', sortOrder: 50, sourceName: 'List Vault', searchAvailable: false, searchScope: 'library' }),
    mediaType({ key: 'custom', label: 'Custom', sortOrder: 60, searchAvailable: false, sourceName: undefined as never }),
  ]
  const tile = (name: string) => screen.getByText(name, { selector: 'b' }).closest('.q-tile') as HTMLElement
  const chip = (name: string) => tile(name).querySelector('.q-key-chip')

  function renderPicker(registry: MediaType[], first = false) {
    vi.mocked(api.lists).mockResolvedValue([])
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <CategoryPicker mediaTypes={registry} first={first} />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })

  function inDesktop() {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
  }

  it('sits on a tile whose source has no key, says so in the words of the design, and explains itself as a description', () => {
    inDesktop()
    renderPicker(KEYLESS)

    expect(chip('Movies')!.textContent).toBe('Free key needed')
    expect(chip('Movies')!.getAttribute('aria-description')).toBe('Searches List Vault now; add a free TMDB key to search TMDB too')
  })

  it('is on no tile whose source can be searched, no Mega tile and no tile of a category searched by hand', () => {
    inDesktop()
    renderPicker(KEYLESS)

    expect(chip('TV Series')).toBeNull()
    expect(chip('Mega')).toBeNull()
    expect(chip('Custom')).toBeNull()
  })

  it('shows on first run as it does on any other visit', () => {
    inDesktop()
    renderPicker(KEYLESS, true)

    expect(chip('Movies')).not.toBeNull()
  })

  it('is never shown in the web build', () => {
    renderPicker(KEYLESS)

    expect(document.querySelector('.q-key-chip')).toBeNull()
  })

  it('keeps the tile’s bottom row at one height with or without the chip, so the source names stay level', () => {
    inDesktop()
    renderPicker(KEYLESS)

    expect(tile('Movies').querySelector('.q-tile-foot')).not.toBeNull()
    expect(tile('TV Series').querySelector('.q-tile-foot')).not.toBeNull()
    expect(tile('TV Series').querySelector('.q-tile-src')!.textContent).toBe('TMDB')
  })
})

describe('the first-run subline and the TMDB callout (H-018, 33.3)', () => {
  const TMDB_KEYLESS: MediaType[] = [
    mediaType({ key: 'movie', label: 'Movies', sortOrder: 10, searchAvailable: false }),
    mediaType({ key: 'tv', label: 'TV Shows', sortOrder: 20, searchAvailable: false }),
    mediaType({ key: 'music', label: 'Music', sortOrder: 30, sourceName: 'MusicBrainz', searchAvailable: true }),
  ]
  const TMDB_KEYED = TMDB_KEYLESS.map((type) => (type.sourceName === 'TMDB' ? { ...type, searchAvailable: true } : type))
  const chips = () => document.querySelectorAll('.q-key-chip')
  const callout = () => document.querySelector('.q-keycard')

  // The callout is hidden in the shipped config (2026-10-26); these tests turn the flag on, as `config/onboarding.json` can.
  function renderFirstRun(registry: MediaType[], first = true, tmdbCallout = true) {
    vi.mocked(api.lists).mockResolvedValue([])
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <CategoryPicker mediaTypes={registry} first={first} tmdbCallout={tmdbCallout} />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )
  }

  function inDesktop() {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
  }

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })

  it('reads as the design says on a first run', () => {
    renderFirstRun(TMDB_KEYLESS)

    expect(screen.getByText('Pick a category to start a list. Those marked Free key needed search List Vault until you add a free API key. Mega is for cross-category franchises')).toBeTruthy()
  })

  it('is hidden by default, even on a first run in the desktop app with no TMDB key; the chips and the subline stay (owner, 2026-10-26)', () => {
    inDesktop()
    vi.mocked(api.lists).mockResolvedValue([])
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <CategoryPicker mediaTypes={TMDB_KEYLESS} first />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )

    expect(callout()).toBeNull()
    expect(screen.queryByText('One free TMDB key unlocks four categories')).toBeNull()
    expect(chips()).toHaveLength(2)
    expect(screen.getByText(/Those marked Free key needed search List Vault/)).toBeTruthy()
  })

  it('shows the callout above the tiles on a first run in the desktop app while there is no TMDB key', () => {
    inDesktop()
    renderFirstRun(TMDB_KEYLESS)

    expect(screen.getByText('One free TMDB key unlocks four categories')).toBeTruthy()
    expect(
      screen.getByText('Movies, TV Series, Animation and Documentaries all search TMDB. Getting a key takes about two minutes. Music, Books, Pro Wrestling, MMA and Mega work right away.'),
    ).toBeTruthy()
    expect(screen.getByPlaceholderText('Your API key')).toBeTruthy()
    const tiles = document.querySelector('.q-tiles')!
    expect(callout()!.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not there on a visit after the first run, in the web build, or once TMDB has a key', () => {
    inDesktop()
    renderFirstRun(TMDB_KEYLESS, false)
    expect(callout()).toBeNull()
    cleanup()

    renderFirstRun(TMDB_KEYED)
    expect(callout()).toBeNull()
    cleanup()

    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
    renderFirstRun(TMDB_KEYLESS)
    expect(callout()).toBeNull()
  })

  it('is not there for a key another source lacks: it is about TMDB', () => {
    inDesktop()
    renderFirstRun([...TMDB_KEYED, mediaType({ key: 'game', label: 'Video Games', sortOrder: 40, sourceName: 'IGDB', searchAvailable: false })])

    expect(callout()).toBeNull()
    expect(chips()).toHaveLength(1)
  })

  it('goes with the chips of the TMDB tiles, all at once, when the key is saved', async () => {
    inDesktop()
    // What the app does when a key is saved: it asks the registry again and hands the picker the new answer.
    function App() {
      const [registry, setRegistry] = useState(TMDB_KEYLESS)
      useRefetchOnRegistryChange(async () => TMDB_KEYED, setRegistry)

      return <CategoryPicker mediaTypes={registry} first tmdbCallout />
    }
    vi.mocked(api.lists).mockResolvedValue([])
    render(
      <LiveRegionProvider>
        <ToastProvider>
          <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
            <App />
          </LayerStackProvider>
        </ToastProvider>
      </LiveRegionProvider>,
    )
    expect(chips()).toHaveLength(2)

    fireEvent.change(screen.getByPlaceholderText('Your API key'), { target: { value: 'a-key' } })
    fireEvent.submit(document.querySelector('form')!)

    // A save, a registry refetch and a render: more than the default second when the whole suite is running.
    await waitFor(() => expect(callout()).toBeNull(), { timeout: 5000 })
    expect(updateLocalSettings).toHaveBeenCalledWith({ tmdbApiKey: 'a-key' })
    expect(chips()).toHaveLength(0)
    expect(screen.getByText('TMDB key saved. You can change it in Settings')).toBeTruthy()
  })
})

describe('the List Vault shelf on the picker (H-018, 33.6; on New List too since 34.3)', () => {
  const REGISTRY_FOR_SHELF = [mediaType({ key: 'movie', label: 'Movies', searchAvailable: true })]
  const ENTRIES = ['movie', 'tv', 'game', 'book', 'music', 'comic'].map((category) => ({
    externalRef: `canonical:lists/${category}/a.yaml`,
    title: `A ${category} list`,
    category,
    itemCount: 3,
  }))
  const sampleButton = () => screen.queryByRole('button', { name: 'Try A Sample List' })

  function renderIt(first: boolean, lists: MediaList[] = []) {
    vi.mocked(api.lists).mockResolvedValue(lists)
    vi.mocked(api.libraryUntracked).mockResolvedValue({ entries: ENTRIES, reachable: true })
    render(
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
        <CategoryPicker mediaTypes={REGISTRY_FOR_SHELF} first={first} />
      </LayerStackProvider>,
    )
  }

  it('is under the tiles on a first run, with Try A Sample List', async () => {
    renderIt(true)

    await waitFor(() => expect(document.querySelectorAll('.q-vault-card')).toHaveLength(3))
    const tiles = document.querySelector('.q-tiles')!
    expect(tiles.compareDocumentPosition(document.querySelector('.q-vault')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sampleButton()).toBeTruthy()
  })

  it('is under the tiles on New List, one screen with the first run: the heading, the close button and the counts of a visit, three cards, no Try A Sample List', async () => {
    renderIt(false, [listIn('movie', 'm1'), listIn('movie', 'm2')])

    await waitFor(() => expect(document.querySelectorAll('.q-vault-card')).toHaveLength(3))
    const tiles = document.querySelector('.q-tiles')!
    expect(tiles.compareDocumentPosition(document.querySelector('.q-vault')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Choose Your Fighter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.q-count-chip')!.textContent).toBe('2'))
    expect(sampleButton()).toBeNull()
  })

  it('is picked again each time the screen opens', async () => {
    const categoriesShown = async (random: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(random)
      renderIt(false, [listIn('movie', 'm1')])
      await waitFor(() => expect(document.querySelectorAll('.q-vault-card')).toHaveLength(3))
      const titles = [...document.querySelectorAll('.q-vault-title')].map((node) => node.textContent)
      cleanup()
      vi.restoreAllMocks()

      return titles
    }

    expect(await categoriesShown(0.01)).not.toEqual(await categoriesShown(0.99))
  })
})

describe('the first-run picker when a list comes back (H-018, 33.8)', () => {
  const FIRST_RUN_PICKER = { id: 'category-picker', kind: 'category-picker', tabLabel: 'Pick', content: '/' }

  /** The picker as the app has it on a first run: the base layer, Home replaced. */
  function FirstRunBase() {
    const { replaceTop } = useLayerStack()
    useEffect(() => replaceTop(FIRST_RUN_PICKER), [])

    return null
  }

  function renderBase() {
    render(
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
        <FirstRunBase />
        <CategoryPicker mediaTypes={[mediaType({ key: 'movie', label: 'Movies' })]} first />
        <StackReader />
      </LayerStackProvider>,
    )
  }

  it('goes back to My Lists when a list is restored (the Undo of Remove Sample), and not before', async () => {
    vi.mocked(api.lists).mockResolvedValue([])
    renderBase()
    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('category-picker:/'))

    notifyListsChanged()
    // A first-run picker does not read the lists on its own; the one call is the answer to the notice.
    await waitFor(() => expect(api.lists).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('stack').textContent).toBe('category-picker:/')

    vi.mocked(api.lists).mockResolvedValue([listIn('movie', 'back')])
    notifyListsChanged()

    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home:/'))
  })

  it('still goes back to My Lists when something else changes the stack while it is checking', async () => {
    let answer: (lists: MediaList[]) => void = () => {}
    vi.mocked(api.lists).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    function Pusher() {
      const { push } = useLayerStack()

      return <button onClick={() => push({ id: 'preview', kind: 'preview', tabLabel: 'P', content: '/p' })}>open a layer</button>
    }
    render(
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
        <FirstRunBase />
        <CategoryPicker mediaTypes={[mediaType({ key: 'movie', label: 'Movies' })]} first />
        <Pusher />
        <StackReader />
      </LayerStackProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('category-picker:/'))

    notifyListsChanged()
    await waitFor(() => expect(api.lists).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('open a layer'))
    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('category-picker:/,preview:/p'))
    answer([listIn('movie', 'back')])

    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home:/'))
  })

  it('does nothing when the check finishes after the picker has gone', async () => {
    let answer: (lists: MediaList[]) => void = () => {}
    vi.mocked(api.lists).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    function Both({ show }: { show: boolean }) {
      return (
        <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
          {show && <CategoryPicker mediaTypes={[mediaType({ key: 'movie', label: 'Movies' })]} first />}
          <StackReader />
        </LayerStackProvider>
      )
    }
    const view = render(<Both show />)

    notifyListsChanged()
    await waitFor(() => expect(api.lists).toHaveBeenCalledTimes(1))
    view.rerender(<Both show={false} />)
    answer([listIn('movie', 'back')])
    await act(async () => {})

    expect(screen.getByTestId('stack').textContent).toBe('home:/')
    expect(api.lists).toHaveBeenCalledTimes(1)
  })
})

