// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { LibraryEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { VaultShelf } from './VaultShelf.js'

vi.mock('../../../lib/api.js', () => ({ api: { libraryUntracked: vi.fn(), createFromSource: vi.fn() } }))

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
