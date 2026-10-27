// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LibraryBrowserEntry } from '../../../../../server/src/ingestion/customLists.js'
import { api, type MediaType } from '../../../lib/api.js'
import { LayerStackProvider, useLayerStack } from '../layerStack/LayerStackContext.js'
import { VaultBrowser } from './VaultBrowser.js'
import { en } from '../../../locale/en.js'

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

/** The layers' paths, to see what a row pushed. */
function PathReader() {
  const { stack } = useLayerStack()

  return <span data-testid="paths">{stack.map((layer) => layer.content).join(' | ')}</span>
}

function mount(answer: { entries: LibraryBrowserEntry[]; reachable: boolean } | Error) {
  if (answer instanceof Error) vi.mocked(api.library).mockRejectedValue(answer)
  else vi.mocked(api.library).mockResolvedValue(answer)

  return render(
    <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
      <VaultBrowser mediaTypes={TYPES} />
      <StackReader />
      <PathReader />
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
    expect(screen.getByText(en.quantum.vaultBrowser.subline)).toBeTruthy()
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

    await waitFor(() => expect(screen.getByText(en.quantum.vaultBrowser.chooseTitle)).toBeTruthy())
    expect(screen.getByText(en.quantum.vaultBrowser.chooseLine(3, 2))).toBeTruthy()
    expect(within(column()).getAllByRole('button').some((button) => button.getAttribute('aria-current') !== null)).toBe(false)
    expect(document.querySelector('.q-vb-caption')).toBeNull()
    expect(document.querySelector('.q-vb-art')).not.toBeNull()
  })

  it('says "1 list in 1 category" for one', async () => {
    mount({ entries: [entry('book', 1)], reachable: true })

    await waitFor(() => expect(screen.getByText(en.quantum.vaultBrowser.chooseLine(1, 1))).toBeTruthy())
  })

  it('selects a category on a click: marked with aria-current, the caption in the pane, the empty state gone', async () => {
    mount({ entries: LIBRARY, reachable: true })
    await waitFor(() => expect(countOf('Movies')).toBe('2'))

    fireEvent.click(categoryButton('Movies'))

    expect(categoryButton('Movies').getAttribute('aria-current')).toBe('true')
    expect(categoryButton('Books').getAttribute('aria-current')).toBeNull()
    expect(document.querySelector('.q-vb-caption')!.textContent).toBe('Movies · 2 lists')
    expect(screen.queryByText(en.quantum.vaultBrowser.chooseTitle)).toBeNull()
  })

  it('cannot select a category with no lists: it is disabled and stays disabled', async () => {
    mount({ entries: LIBRARY, reachable: true })
    await waitFor(() => expect(countOf('Movies')).toBe('2'))

    fireEvent.click(categoryButton('Games'))

    expect(categoryButton('Games').getAttribute('aria-disabled')).toBe('true')
    expect(categoryButton('Games').getAttribute('aria-current')).toBeNull()
    expect(screen.getByText(en.quantum.vaultBrowser.chooseTitle)).toBeTruthy()
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
      expect(screen.getByText(en.quantum.vaultBrowser.chooseTitle)).toBeTruthy()
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

    it('opens the List Preview of a row on a click, with the list\'s own source and no options', async () => {
      await open()

      fireEvent.click(rowsOf()[1]!)

      expect(screen.getByTestId('stack').textContent).toBe('home,preview')
      const preview = new URL(screen.getByTestId('paths').textContent!.split(' | ')[1]!, 'http://x')
      expect(preview.pathname).toBe('/lists/preview')
      expect(Object.fromEntries(preview.searchParams)).toEqual({ mediaType: 'movie', externalRef: 'canonical:lists/movie/2.yaml', title: 'movie 2' })
    })

    it('hands the Preview the id of a list the person already tracks, and only for that one', async () => {
      mount({ entries: [entry('movie', 1, true, { trackedListId: 'list-7' }), entry('movie', 2)], reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      fireEvent.click(categoryButton('Movies'))

      fireEvent.click(rowsOf()[0]!)

      expect(new URL(screen.getByTestId('paths').textContent!.split(' | ')[1]!, 'http://x').searchParams.get('trackedListId')).toBe('list-7')
      cleanup()
      mount({ entries: [entry('movie', 2)], reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('1'))
      fireEvent.click(categoryButton('Movies'))
      fireEvent.click(rowsOf()[0]!)

      expect(new URL(screen.getByTestId('paths').textContent!.split(' | ')[1]!, 'http://x').searchParams.has('trackedListId')).toBe(false)
    })

    it('keeps the sort when another category is picked', async () => {
      await open()
      fireEvent.click(within(header('Time')).getByRole('button'))

      fireEvent.click(categoryButton('Books'))

      expect(header('Time').getAttribute('aria-sort')).toBe('descending')
    })
  })

  describe('the keyboard, as in a file manager (36.6)', () => {
    const key = (element: Element, name: string) => fireEvent.keyDown(element, { key: name })
    const focused = () => document.activeElement as HTMLElement
    const nameOf = (element: Element | null) => element?.querySelector('.q-vb-name, .q-vb-rowname')?.textContent

    /** Books 1, Movies 2; Games and TV Series have none (disabled). Opens with Movies selected and focused. */
    async function openMovies() {
      mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      categoryButton('Movies').focus()
      fireEvent.click(categoryButton('Movies'))
    }

    it('moves through the column with the arrows and selects as it goes, skipping a category with no lists', async () => {
      mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      categoryButton('Books').focus()

      key(focused(), 'ArrowDown')

      // Games (no lists) is passed over.
      expect(nameOf(focused())).toBe('Movies')
      expect(categoryButton('Movies').getAttribute('aria-current')).toBe('true')
      key(focused(), 'ArrowUp')
      expect(nameOf(focused())).toBe('Books')
      expect(categoryButton('Books').getAttribute('aria-current')).toBe('true')
      expect(categoryButton('Movies').getAttribute('aria-current')).toBeNull()
    })

    it('stops at the ends of the column rather than wrapping', async () => {
      await openMovies()

      key(focused(), 'ArrowDown')
      expect(nameOf(focused())).toBe('Movies')
      key(focused(), 'Home')
      key(focused(), 'ArrowUp')
      expect(nameOf(focused())).toBe('Books')
    })

    it('jumps to the first and the last category with lists on Home and End, and selects it', async () => {
      await openMovies()

      key(focused(), 'Home')
      expect(nameOf(focused())).toBe('Books')
      expect(categoryButton('Books').getAttribute('aria-current')).toBe('true')
      key(focused(), 'End')
      expect(nameOf(focused())).toBe('Movies')
      expect(categoryButton('Movies').getAttribute('aria-current')).toBe('true')
    })

    it('keeps the page from scrolling on the keys it uses, and leaves the others alone', async () => {
      await openMovies()

      expect(fireEvent.keyDown(focused(), { key: 'ArrowUp' })).toBe(false)
      expect(fireEvent.keyDown(focused(), { key: 'a' })).toBe(true)
    })

    it('does not select anything while the library is loading, or out of reach', () => {
      vi.mocked(api.library).mockReturnValue(new Promise(() => undefined))
      mount({ entries: [], reachable: true })
      categoryButton('Books').focus()

      key(focused(), 'ArrowDown')

      expect(within(column()).getAllByRole('button').some((button) => button.getAttribute('aria-current') !== null)).toBe(false)
    })

    it('goes from the column to the first row with →, and nowhere when there is no table yet', async () => {
      mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      categoryButton('Books').focus()
      key(focused(), 'ArrowRight')
      expect(focused()).toBe(categoryButton('Books'))

      fireEvent.click(categoryButton('Movies'))
      categoryButton('Movies').focus()
      key(focused(), 'ArrowRight')

      expect(nameOf(focused())).toBe('movie 1')
      expect(focused().classList.contains('q-vb-row')).toBe(true)
    })

    it('moves between the rows with ↑ and ↓ and jumps with Home and End', async () => {
      await openMovies()
      categoryButton('Movies').focus()
      key(focused(), 'ArrowRight')

      key(focused(), 'ArrowDown')
      expect(nameOf(focused())).toBe('movie 2')
      key(focused(), 'ArrowDown')
      expect(nameOf(focused())).toBe('movie 2')
      key(focused(), 'ArrowUp')
      expect(nameOf(focused())).toBe('movie 1')
      key(focused(), 'End')
      expect(nameOf(focused())).toBe('movie 2')
      key(focused(), 'Home')
      expect(nameOf(focused())).toBe('movie 1')
    })

    it('goes back to the selected category with ← from a row', async () => {
      await openMovies()
      categoryButton('Movies').focus()
      key(focused(), 'ArrowRight')
      expect(focused().classList.contains('q-vb-row')).toBe(true)

      key(focused(), 'ArrowLeft')

      expect(focused()).toBe(categoryButton('Movies'))
    })

    /** What Tab can land on, in page order: a button with tabindex -1 is reached by the arrow keys only. */
    const tabStops = (container: HTMLElement) =>
      [...container.querySelectorAll('button')]
        .filter((button) => button.tabIndex >= 0)
        .map((button) =>
          button.closest('.q-vb-head') ? 'close' : button.closest('.q-vb-column') ? 'category' : button.closest('.q-vb-headrow') ? 'header' : button.closest('.q-vb-row') ? 'row' : 'other',
        )

    it('puts the Tab order as ✕, the column (one stop), the four headers, the rows (one stop): a roving tabindex (design, 2026-10-27)', async () => {
      const view = mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      fireEvent.click(categoryButton('Movies'))

      expect(tabStops(view.container)).toEqual(['close', 'category', 'header', 'header', 'header', 'header', 'row'])
    })

    it('makes the selected category the column\'s stop, and the first one with lists while none is selected', async () => {
      mount({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      const stops = () => within(column()).getAllByRole('button').filter((button) => button.tabIndex >= 0).map((button) => button.querySelector('.q-vb-name')!.textContent)

      expect(stops()).toEqual(['Books'])
      fireEvent.click(categoryButton('Movies'))
      expect(stops()).toEqual(['Movies'])
    })

    it('gives the column no stop while the library loads: ✕ alone, and every category is aria-disabled but still there to read (design, 2026-10-27)', () => {
      vi.mocked(api.library).mockReturnValue(new Promise(() => undefined))
      const view = mount({ entries: [], reachable: true })

      expect(tabStops(view.container)).toEqual(['close'])
      for (const button of within(column()).getAllByRole('button')) {
        expect(button.tabIndex).toBe(-1)
        expect(button.getAttribute('aria-disabled')).toBe('true')
      }
    })

    it('gives the column no stop when the library is out of reach either: ✕, then Try Again', async () => {
      const view = mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())

      expect(tabStops(view.container)).toEqual(['close', 'other'])
      expect(screen.getByRole('button', { name: 'Try Again' }).closest('.q-vb-column')).toBeNull()
    })

    it('gives the column no stop when the library has no list at all', async () => {
      const view = mount({ entries: [], reachable: true })
      await waitFor(() => expect(screen.getByText(en.quantum.vaultBrowser.chooseLine(0, 0))).toBeTruthy())

      expect(tabStops(view.container)).toEqual(['close'])
    })

    it('gives the stop back, on the first category with lists, when the library answers, and does not move the focus', async () => {
      let answer!: (value: { entries: LibraryBrowserEntry[]; reachable: boolean }) => void
      vi.mocked(api.library).mockReturnValue(new Promise((resolve) => (answer = resolve)))
      // Rendered here, not by `mount`, which sets its own answer.
      const view = render(
        <LayerStackProvider home={{ id: 'home', kind: 'home', tabLabel: 'My Lists', content: '/' }}>
          <VaultBrowser mediaTypes={TYPES} />
        </LayerStackProvider>,
      )
      const close = screen.getByRole('button', { name: 'Close List Vault' })
      close.focus()

      answer({ entries: LIBRARY, reachable: true })
      await waitFor(() => expect(countOf('Movies')).toBe('2'))

      expect(tabStops(view.container)).toEqual(['close', 'category'])
      expect(categoryButton('Books').tabIndex).toBe(0)
      expect(document.activeElement).toBe(close)
    })

    it('says the loading and the out-of-reach messages in a polite live region, without a stop (design, 2026-10-27)', async () => {
      vi.mocked(api.library).mockReturnValueOnce(new Promise(() => undefined))
      mount({ entries: [], reachable: true })
      expect(screen.getByRole('status').textContent).toContain('Loading List Vault…')
      cleanup()

      mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByRole('status').textContent).toContain('List Vault is out of reach'))
      expect(screen.getByRole('status').textContent).toContain('List Vault needs an internet connection to show its lists.')
      expect(screen.getByRole('status').getAttribute('aria-live') ?? 'polite').toBe('polite')
    })

    it('moves the focus to the column\'s stop when Try Again succeeds and its button is gone', async () => {
      mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())
      vi.mocked(api.library).mockResolvedValue({ entries: LIBRARY, reachable: true })
      const retry = screen.getByRole('button', { name: 'Try Again' })
      retry.focus()

      fireEvent.click(retry)

      await waitFor(() => expect(countOf('Movies')).toBe('2'))
      expect(document.activeElement).toBe(categoryButton('Books'))
    })

    it('leaves the focus where it is when Try Again fails', async () => {
      mount({ entries: [], reachable: false })
      await waitFor(() => expect(screen.getByText('List Vault is out of reach')).toBeTruthy())
      const retry = screen.getByRole('button', { name: 'Try Again' })
      retry.focus()

      fireEvent.click(retry)

      await waitFor(() => expect(vi.mocked(api.library)).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(retry.hasAttribute('disabled')).toBe(false))
      expect(screen.getByText('List Vault is out of reach')).toBeTruthy()
      expect(within(column()).getAllByRole('button').every((button) => button.tabIndex === -1)).toBe(true)
    })

    it('makes the row last focused the table\'s stop, the first row after a category change', async () => {
      await openMovies()
      const stop = () => [...document.querySelectorAll<HTMLElement>('.q-vb-row')].filter((row) => row.tabIndex >= 0).map((row) => nameOf(row))
      expect(stop()).toEqual(['movie 1'])

      categoryButton('Movies').focus()
      key(focused(), 'ArrowRight')
      key(focused(), 'ArrowDown')
      expect(stop()).toEqual(['movie 2'])

      fireEvent.click(categoryButton('Books'))
      fireEvent.click(categoryButton('Movies'))
      expect(stop()).toEqual(['movie 1'])
    })

    it('names the table by its caption, and says why a category cannot be picked', async () => {
      await openMovies()

      expect(screen.getByRole('group', { name: 'Movies · 2 lists' })).toBeTruthy()
      expect(categoryButton('Games').getAttribute('aria-description')).toBe('No List Vault lists in this category yet')
    })
  })
})
