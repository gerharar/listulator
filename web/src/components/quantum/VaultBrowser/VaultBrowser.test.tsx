// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { VaultBrowser } from './VaultBrowser.js'

vi.mock('../../../lib/api.js', () => ({ api: { library: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function type(key: string, label: string): MediaType {
  return { key, label, sortOrder: 10, defaultDurationMinutes: 30, searchAvailable: true, previewable: true }
}

// Out of alphabetical order on purpose: the column is A to Z by the name shown, not the registry's order.
const TYPES = [type('tv', 'TV Series'), type('movie', 'Movies'), type('book', 'Books'), type('game', 'Games')]

const entry = (category: string, n: number, tracked = false): LibraryBrowserEntry => ({
  externalRef: `canonical:lists/${category}/${n}.yaml`,
  title: `${category} ${n}`,
  category,
  itemCount: 5,
  tracked,
})

/** Movies 2 (one of them already tracked), Books 1, TV Series 0, Games 0: 3 lists in 2 categories. */
const LIBRARY = [entry('movie', 1, true), entry('movie', 2), entry('book', 1)]

function StackReader() {
  const { stack } = useLayerStack()

  return <span data-testid="stack">{stack.map((layer) => layer.kind).join(',')}</span>
}

function mount(answer: { entries: LibraryBrowserEntry[]; reachable: boolean } | Error) {
  if (answer instanceof Error) vi.mocked(api.library).mockRejectedValue(answer)
  else vi.mocked(api.library).mockResolvedValue(answer)

  return render(
    <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
      <VaultBrowser mediaTypes={TYPES} />
      <StackReader />
    </LayerStackProvider>,
  )
}

const column = () => screen.getByRole('navigation', { name: 'Categories' })
const categoryButton = (name: string) => within(column()).getByRole('button', { name: new RegExp(`^${name}`) })
const countOf = (name: string) => categoryButton(name).querySelector('.q-vb-count')!.textContent

describe('VaultBrowser', () => {
  it('has the heading and the subline of the design', async () => {
    mount({ entries: LIBRARY, reachable: true })

    expect(screen.getByRole('heading', { level: 1, name: 'List Vault' })).toBeTruthy()
    expect(screen.getByText('Canonical lists anyone can open, no key needed. Nothing is added until you choose Add This List.')).toBeTruthy()
    await waitFor(() => expect(countOf('Movies')).toBe('2'))
  })

  it('lists every category A to Z by the name shown, with the count of the index, tracked lists included', async () => {
    mount({ entries: LIBRARY, reachable: true })

    await waitFor(() => expect(countOf('Movies')).toBe('2'))
    expect(within(column()).getAllByRole('button').map((button) => button.querySelector('.q-vb-name')!.textContent)).toEqual(['Books', 'Games', 'Movies', 'TV Series'])
    expect([countOf('Books'), countOf('Games'), countOf('Movies'), countOf('TV Series')]).toEqual(['1', '0', '2', '0'])
  })

  it('opens on the empty state: no category selected, no rows, the library counted', async () => {
    mount({ entries: LIBRARY, reachable: true })

    await waitFor(() => expect(screen.getByText('Choose a category')).toBeTruthy())
    expect(screen.getByText('3 lists in 2 categories. Pick one on the left to see its lists.')).toBeTruthy()
    expect(within(column()).getAllByRole('button').some((button) => button.getAttribute('aria-current') !== null)).toBe(false)
    expect(document.querySelector('.q-vb-caption')).toBeNull()
    expect(document.querySelector('.q-vb-art')).not.toBeNull()
  })

  it('says "1 list in 1 category" for one', async () => {
    mount({ entries: [entry('book', 1)], reachable: true })

    await waitFor(() => expect(screen.getByText('1 list in 1 category. Pick one on the left to see its lists.')).toBeTruthy())
  })

  it('selects a category on a click: marked with aria-current, the caption in the pane, the empty state gone', async () => {
    mount({ entries: LIBRARY, reachable: true })
    await waitFor(() => expect(countOf('Movies')).toBe('2'))

    fireEvent.click(categoryButton('Movies'))

    expect(categoryButton('Movies').getAttribute('aria-current')).toBe('true')
    expect(categoryButton('Books').getAttribute('aria-current')).toBeNull()
    expect(document.querySelector('.q-vb-caption')!.textContent).toBe('Movies · 2 lists')
    expect(screen.queryByText('Choose a category')).toBeNull()
  })

  it('cannot select a category with no lists: it is disabled and stays disabled', async () => {
    mount({ entries: LIBRARY, reachable: true })
    await waitFor(() => expect(countOf('Movies')).toBe('2'))

    fireEvent.click(categoryButton('Games'))

    expect(categoryButton('Games').getAttribute('aria-disabled')).toBe('true')
    expect(categoryButton('Games').getAttribute('aria-current')).toBeNull()
    expect(screen.getByText('Choose a category')).toBeTruthy()
  })

  it('shows every category with no count, and the loading line, until the library has answered; nothing can be picked yet', () => {
    vi.mocked(api.library).mockReturnValue(new Promise(() => undefined))
    mount({ entries: [], reachable: true })

    expect(within(column()).getAllByRole('button')).toHaveLength(4)
    expect(countOf('Movies')).toBe('')
    expect(screen.getByText('Loading List Vault…')).toBeTruthy()

    fireEvent.click(categoryButton('Movies'))

    expect(categoryButton('Movies').getAttribute('aria-current')).toBeNull()
  })

  describe('with the library out of reach', () => {
    it('disables every category with a dash and says so, with the shelf\'s line', async () => {
      mount({ entries: [], reachable: false })

      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())
      expect(screen.getByText('List Vault needs an internet connection to show its lists.')).toBeTruthy()
      for (const name of ['Books', 'Games', 'Movies', 'TV Series']) {
        expect(categoryButton(name).getAttribute('aria-disabled')).toBe('true')
        expect(countOf(name)).toBe('—')
      }
    })

    it('treats a failed fetch the same way', async () => {
      mount(new Error('offline'))

      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())
    })

    it('asks again on Try Again and fills in place when the library answers', async () => {
      mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())
      vi.mocked(api.library).mockResolvedValue({ entries: LIBRARY, reachable: true })

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      expect(screen.getByText('Choose a category')).toBeTruthy()
      expect(screen.queryByText('List Vault is out of reach')).toBeNull()
      expect(vi.mocked(api.library)).toHaveBeenCalledTimes(2)
    })

    it('stays out of reach when Try Again fails too', async () => {
      mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())

      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))

      await waitFor(() => expect(vi.mocked(api.library)).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Try Again' }).hasAttribute('disabled')).toBe(false))
      expect(screen.getByText('List Vault is out of reach')).toBeTruthy()
    })
  })

  it('closes with the ✕', async () => {
    const view = mount({ entries: LIBRARY, reachable: true })
    await waitFor(() => expect(countOf('Movies')).toBe('2'))

    fireEvent.click(within(view.container).getByRole('button', { name: 'Close List Vault' }))

    // The provider's home layer is the only one: popping it leaves it, which is the shell's business (App.tsx); the click reached the stack.
    expect(screen.getByTestId('stack').textContent).toBe('home')
  })
})
