// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { VaultShelf } from './VaultShelf.js'

vi.mock('../../../lib/api.js', () => ({ api: { libraryUntracked: vi.fn(), createFromSource: vi.fn(), lists: vi.fn(), updateList: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function type(key: string, label: string): MediaType {
  return { key, label, sortOrder: 10, defaultDurationMinutes: 30, searchAvailable: true, previewable: true }
}

const TYPES = ['movie', 'tv', 'game', 'book', 'music', 'comic', 'wrestling', 'mma'].map((key) => type(key, key === 'tv' ? 'TV Shows' : key[0]!.toUpperCase() + key.slice(1)))

const entries = (categories: string[], per = 2): LibraryEntry[] =>
  categories.flatMap((category) =>
    Array.from({ length: per }, (_, n): LibraryEntry => ({ externalRef: `canonical:lists/${category}/${n}.yaml`, title: `${category} list ${n}`, category, itemCount: 5 + n })),
  )

function StackReader() {
  const { stack } = useLayerStack()

  return <span data-testid="stack">{stack.map((layer) => `${layer.kind}:${layer.content}`).join(',')}</span>
}

function mount(answer: { entries: LibraryEntry[]; reachable: boolean } | Error, random = () => 0.3) {
  if (answer instanceof Error) vi.mocked(api.libraryUntracked).mockRejectedValue(answer)
  else vi.mocked(api.libraryUntracked).mockResolvedValue(answer)
  const view = render(
    <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
      <VaultShelf mediaTypes={TYPES} random={random} />
      <StackReader />
    </LayerStackProvider>,
  )

  return view
}

const cards = () => [...document.querySelectorAll('.q-vault-card')] as HTMLElement[]

describe('VaultShelf', () => {
  it('has its label and its line, and no cards until the library has answered', () => {
    mount({ entries: entries(['movie']), reachable: true })

    expect(screen.getByText('Or start from List Vault')).toBeTruthy()
    expect(screen.getByText('Canonical lists anyone can open, no key needed. Preview one; nothing is added until you choose Add This List.')).toBeTruthy()
    expect(cards()).toHaveLength(0)
  })

  it('shows six cards, each from a different category, with the category and the number of items', async () => {
    mount({ entries: entries(['movie', 'tv', 'game', 'book', 'music', 'comic', 'wrestling', 'mma']), reachable: true })

    await waitFor(() => expect(cards()).toHaveLength(6))
    const kinds = cards().map((card) => card.querySelector('.q-vault-meta')!.textContent!.split(' · ')[0])
    expect(new Set(kinds).size).toBe(6)
    for (const card of cards()) expect(card.querySelector('.q-vault-meta')!.textContent).toMatch(/ · \d+ items$/)
  })

  it('names the category as the app does, and says "1 item" for one', async () => {
    mount({ entries: [{ externalRef: 'canonical:lists/tv/a.yaml', title: 'A Show', category: 'tv', itemCount: 1 }], reachable: true })

    await waitFor(() => expect(cards()).toHaveLength(1))
    expect(cards()[0]!.querySelector('.q-vault-title')!.textContent).toBe('A Show')
    expect(cards()[0]!.querySelector('.q-vault-meta')!.textContent).toBe('TV Series · 1 item')
  })

  it('shows a card for each category when the library has fewer than six', async () => {
    mount({ entries: entries(['movie', 'tv']), reachable: true })

    await waitFor(() => expect(cards()).toHaveLength(2))
  })

  it('keeps the same six while the screen stays open, whatever the random source would now say', async () => {
    let calls = 0
    const view = mount({ entries: entries(['movie', 'tv', 'game', 'book', 'music', 'comic', 'wrestling', 'mma']), reachable: true }, () => (calls += 1) / 1000 + 0.1)
    await waitFor(() => expect(cards()).toHaveLength(6))
    const before = cards().map((card) => card.textContent)

    view.rerender(
      <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
        <VaultShelf mediaTypes={TYPES} random={() => 0.99} />
        <StackReader />
      </LayerStackProvider>,
    )

    expect(cards().map((card) => card.textContent)).toEqual(before)
  })

  it('opens the existing Preview of the list and adds nothing', async () => {
    mount({ entries: [{ externalRef: 'canonical:lists/movie/bond.yaml', title: 'James Bond', category: 'movie', itemCount: 25 }], reachable: true })
    await waitFor(() => expect(cards()).toHaveLength(1))

    fireEvent.click(cards()[0]!)

    expect(screen.getByTestId('stack').textContent).toContain(
      'preview:/lists/preview?mediaType=movie&externalRef=canonical%3Alists%2Fmovie%2Fbond.yaml&title=James+Bond',
    )
    expect(api.createFromSource).not.toHaveBeenCalled()
  })

  it('says it needs an internet connection when the library cannot be reached, and shows no cards', async () => {
    mount({ entries: [], reachable: false })

    expect(await screen.findByText('List Vault needs an internet connection to show its lists.')).toBeTruthy()
    expect(screen.getByText('Or start from List Vault')).toBeTruthy()
    expect(cards()).toHaveLength(0)
  })

  it('says the same when asking the library fails', async () => {
    mount(new Error('offline'))

    expect(await screen.findByText('List Vault needs an internet connection to show its lists.')).toBeTruthy()
  })

  it('is not drawn at all when the library is reachable but has nothing to offer', async () => {
    mount({ entries: [], reachable: true })

    await waitFor(() => expect(document.querySelector('.q-vault')).toBeNull())
  })
})

describe('Try A Sample List (33.8)', () => {
  const MCU: LibraryEntry = { externalRef: 'canonical:lists/mega/mcu-extended.yaml', title: 'Marvel Cinematic Universe', category: 'mega', itemCount: 559 }
  const OTHER: LibraryEntry = { externalRef: 'canonical:lists/tv/other.yaml', title: 'Other', category: 'tv', itemCount: 5 }
  const button = () => screen.getByRole('button', { name: 'Try A Sample List' }) as HTMLButtonElement

  async function ready(entriesGiven: LibraryEntry[] = [MCU, OTHER]) {
    vi.mocked(api.lists).mockResolvedValue([])
    vi.mocked(api.createFromSource).mockResolvedValue({ id: 'sample-1', title: MCU.title } as never)
    vi.mocked(api.updateList).mockResolvedValue({ id: 'sample-1', isSample: true } as never)
    mount({ entries: entriesGiven, reachable: true })
    await waitFor(() => expect(button().disabled).toBe(false))
  }

  it('is a secondary button next to the label and the line, and does nothing by itself', async () => {
    await ready()

    expect(button().classList.contains('quiet') || button().classList.contains('q-btn')).toBe(true)
    expect(api.createFromSource).not.toHaveBeenCalled()
  })

  it('adds the list the config names, marks it a sample, and opens it with Home under it', async () => {
    await ready()

    fireEvent.click(button())

    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home:/,list:/lists/sample-1'))
    expect(api.createFromSource).toHaveBeenCalledWith({ mediaType: 'mega', externalRef: 'canonical:lists/mega/mcu-extended.yaml', title: 'Marvel Cinematic Universe' })
    expect(api.updateList).toHaveBeenCalledWith('sample-1', { isSample: true })
  })

  it('takes a random list when the configured one is not in the library', async () => {
    await ready([OTHER])
    vi.mocked(api.createFromSource).mockResolvedValue({ id: 'other-1', title: 'Other' } as never)

    fireEvent.click(button())

    await waitFor(() => expect(api.createFromSource).toHaveBeenCalledWith(expect.objectContaining({ externalRef: OTHER.externalRef })))
  })

  it('opens the sample that already exists instead of adding another', async () => {
    await ready()
    vi.mocked(api.lists).mockResolvedValue([{ id: 'have-1', isSample: true } as never, { id: 'mine', isSample: false } as never])

    fireEvent.click(button())

    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home:/,list:/lists/have-1'))
    expect(api.createFromSource).not.toHaveBeenCalled()
  })

  it('is disabled with the line when List Vault cannot be reached', async () => {
    vi.mocked(api.libraryUntracked).mockResolvedValue({ entries: [], reachable: false })
    mount({ entries: [], reachable: false })

    expect(await screen.findByText('List Vault needs an internet connection to show its lists.')).toBeTruthy()
    expect(button().disabled).toBe(true)
  })

  it('says it failed, stays where it is, and can be pressed again, when adding fails', async () => {
    await ready()
    vi.mocked(api.createFromSource).mockRejectedValueOnce(new Error('network'))

    fireEvent.click(button())

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('stack').textContent).toBe('home:/')
    expect(button().disabled).toBe(false)
  })

  it('keeps the list, unmarked, when only the marking fails: it opens and nothing is lost', async () => {
    await ready()
    vi.mocked(api.updateList).mockRejectedValueOnce(new Error('network'))

    fireEvent.click(button())

    await waitFor(() => expect(screen.getByTestId('stack').textContent).toBe('home:/,list:/lists/sample-1'))
  })

  it('ignores a second press while it is adding', async () => {
    await ready()
    let finish: (value: never) => void = () => {}
    vi.mocked(api.createFromSource).mockReturnValue(new Promise((resolve) => (finish = resolve as never)))

    fireEvent.click(button())
    fireEvent.click(button())
    finish({ id: 'sample-1', title: 'x' } as never)

    await waitFor(() => expect(api.createFromSource).toHaveBeenCalledTimes(1))
  })
})
