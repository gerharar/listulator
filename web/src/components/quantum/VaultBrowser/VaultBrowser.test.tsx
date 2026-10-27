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

const entry = (category: string, n: number, tracked = false, extra: Partial<LibraryBrowserEntry> = {}): LibraryBrowserEntry => ({
  externalRef: `canonical:lists/${category}/${n}.yaml`,
  title: `${category} ${n}`,
  category,
  itemCount: 5,
  tracked,
  ...extra,
})

/** Movies 2 (the first already tracked, complete, an estimated 90 minutes; the second ongoing, 45 minutes known), Books 1, TV Series 0, Games 0: 3 lists in 2 categories. */
const LIBRARY = [
  entry('movie', 1, true, { itemCount: 12, status: 'complete', totalMinutes: 90, minutesEstimated: true }),
  entry('movie', 2, false, { itemCount: 3, status: 'ongoing', totalMinutes: 45, minutesEstimated: false }),
  entry('book', 1),
]

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

  describe('the table of a category (36.4)', () => {
    const rowsOf = () => [...document.querySelectorAll('.q-vb-row')] as HTMLElement[]
    const cell = (row: HTMLElement, name: string) => row.querySelector(`.q-vb-${name}`)!
    const header = (name: string) => screen.getByRole('columnheader', { name })

    async function open(category = 'Movies') {
      mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      fireEvent.click(categoryButton(category))
    }

    it('shows a row for each list of the category and none for the others', async () => {
      await open()

      expect(rowsOf().map((row) => cell(row, 'rowname').textContent)).toEqual(['movie 1', 'movie 2'])
    })

    it('writes the status as the short chip, and an unknown status as a dash that says so', async () => {
      await open('Books')
      expect(cell(rowsOf()[0]!, 'status').textContent).toBe('—')
      cleanup()

      await open()
      expect(rowsOf().map((row) => cell(row, 'status').textContent)).toEqual(['Complete', 'Ongoing'])
      expect(cell(rowsOf()[0]!, 'status').querySelector('.q-status.short')).not.toBeNull()
    })

    it('writes the items and the time: minutes under an hour, whole hours above, ≈ only where an item has no runtime', async () => {
      await open()

      expect(rowsOf().map((row) => [cell(row, 'items').textContent, cell(row, 'time').textContent])).toEqual([
        ['12', '≈2h'],
        ['3', '45m'],
      ])
    })

    it('writes a dash for an item count or a time an older index did not give', async () => {
      mount({ entries: [entry('book', 1, false, { itemCount: undefined })], reachable: true })
      await waitFor(() => expect(countOf('Books')).toBe('1'))
      fireEvent.click(categoryButton('Books'))

      expect(cell(rowsOf()[0]!, 'items').textContent).toBe('—')
      expect(cell(rowsOf()[0]!, 'time').textContent).toBe('—')
    })

    it('marks a list the person already has with In My Lists after its name, and no other', async () => {
      await open()

      expect(rowsOf().map((row) => row.querySelector('.q-vb-mine')?.textContent ?? null)).toEqual(['In My Lists', null])
    })

    it('opens sorted by name, ascending, and says so on the header', async () => {
      await open()

      expect(header('Name').getAttribute('aria-sort')).toBe('ascending')
      expect(header('Items').getAttribute('aria-sort')).toBe('none')
      expect(header('Name').textContent).toContain('▲')
    })

    it('sorts by a header: Items largest first, then reversed', async () => {
      await open()

      fireEvent.click(within(header('Items')).getByRole('button'))
      expect(rowsOf().map((row) => cell(row, 'rowname').textContent)).toEqual(['movie 1', 'movie 2'])
      expect(header('Items').getAttribute('aria-sort')).toBe('descending')
      // Drawn on the label's left by the CSS (a number column's header ends on its numbers' edge; measured in Playwright).
      expect(header('Items').classList.contains('number')).toBe(true)
      expect(header('Items').querySelector('.q-vb-arrow')!.textContent).toBe('▼')
      expect(header('Name').getAttribute('aria-sort')).toBe('none')

      fireEvent.click(within(header('Items')).getByRole('button'))
      expect(rowsOf().map((row) => cell(row, 'rowname').textContent)).toEqual(['movie 2', 'movie 1'])
      expect(header('Items').getAttribute('aria-sort')).toBe('ascending')
    })

    it('sorts Status complete first, and the arrow of a text column is on the right', async () => {
      await open()

      fireEvent.click(within(header('Status')).getByRole('button'))

      expect(rowsOf().map((row) => cell(row, 'rowname').textContent)).toEqual(['movie 1', 'movie 2'])
      expect(header('Status').textContent).toBe('Status▲')
    })

    it('keeps the sort when another category is picked', async () => {
      await open()
      fireEvent.click(within(header('Time')).getByRole('button'))

      fireEvent.click(categoryButton('Books'))

      expect(header('Time').getAttribute('aria-sort')).toBe('descending')
    })
  })
})
