// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError, api, type MediaType } from '../../../lib/api.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ImportFileTab, peekCategory } from './ImportFileTab.js'

vi.mock('../../../lib/api.js', async () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code?: string,
    ) {
      super(message)
    }
  }

  return { ApiError: MockApiError, api: { createFromFile: vi.fn() } }
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const YAML = 'title: X\ncategory: movie\nitems:\n  - { title: A }\n'

const box = () => screen.getByLabelText(/^YAML/) as HTMLTextAreaElement
const dialog = () => screen.getByRole('dialog')
const importButton = () => screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement

function chooseFile(text: string, name = 'comfort-rewatches.yaml', size = text.length) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = { name, size, text: async () => text } as unknown as File
  fireEvent.change(input, { target: { files: [file] } })
}

const MEDIA_TYPES = [
  { key: 'movie', label: 'Movies' },
  { key: 'game', label: 'Games' },
] as MediaType[]

function renderTab(onBuilt = vi.fn(), mediaTypeKey = 'movie') {
  render(
    <OverlayManagerProvider>
      <ImportFileTab mediaTypes={MEDIA_TYPES} mediaTypeKey={mediaTypeKey} onBuilt={onBuilt} />
    </OverlayManagerProvider>,
  )
  return onBuilt
}

describe('ImportFileTab', () => {
  it('cannot import while the box is empty', () => {
    renderTab()

    expect(importButton().disabled).toBe(true)
    fireEvent.change(box(), { target: { value: YAML } })
    expect(importButton().disabled).toBe(false)
  })

  it('reads a chosen file into the box, read-only, with a fact-only read-out', async () => {
    renderTab()

    chooseFile(YAML, 'comfort-rewatches.yaml', 2048)

    await waitFor(() => expect(box().value).toBe(YAML))
    expect(screen.getByText('comfort-rewatches.yaml · 2 KB · 4 lines')).toBeTruthy()
    expect(box().readOnly).toBe(true)
    expect(screen.getByText('Click to edit')).toBeTruthy()

    fireEvent.click(box())
    expect(box().readOnly).toBe(false)
  })

  it('states the read-out once — editing the text does not recompute it', async () => {
    renderTab()
    chooseFile(YAML, 'a.yaml', 100)
    await waitFor(() => expect(box().value).toBe(YAML))

    fireEvent.click(box())
    fireEvent.change(box(), { target: { value: `${YAML}\n\n\nmore` } })

    expect(screen.getByText('a.yaml · 100 B · 4 lines')).toBeTruthy()
  })

  it('a second file replaces the box outright, read-only again', async () => {
    renderTab()
    chooseFile(YAML, 'one.yaml')
    await waitFor(() => expect(box().value).toBe(YAML))
    fireEvent.click(box())

    chooseFile('title: Y\n', 'two.yaml', 9)

    await waitFor(() => expect(box().value).toBe('title: Y\n'))
    expect(box().readOnly).toBe(true)
    expect(screen.getByText('two.yaml · 9 B · 1 line')).toBeTruthy()
  })

  it('reads out "Pasted" with the pasted line count', () => {
    renderTab()

    fireEvent.paste(box(), { clipboardData: { getData: () => 'a\nb\nc' } })

    expect(screen.getByText('Pasted · 3 lines')).toBeTruthy()
  })

  it('says nothing about validity before Import', () => {
    renderTab()
    fireEvent.change(box(), { target: { value: 'not: [valid' } })

    expect(screen.queryByText(/cannot be imported/)).toBeNull()
    expect(api.createFromFile).not.toHaveBeenCalled()
  })

  it('imports the text as it stands and opens the new list', async () => {
    vi.mocked(api.createFromFile).mockResolvedValue({ id: 'L9' } as never)
    const onBuilt = renderTab()

    fireEvent.change(box(), { target: { value: YAML } })
    fireEvent.click(importButton())

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L9'))
    expect(api.createFromFile).toHaveBeenCalledWith({ yaml: YAML })
    // Same category as the screen: nothing to ask.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before importing a file of another category, naming both (U3)', async () => {
    vi.mocked(api.createFromFile).mockResolvedValue({ id: 'L9' } as never)
    const onBuilt = renderTab(vi.fn(), 'game')

    fireEvent.change(box(), { target: { value: YAML } })
    fireEvent.click(importButton())

    expect(screen.getByText('Import to Movies?')).not.toBeNull()
    const note = within(dialog()).getByText(/^Current category is/)
    expect(note.textContent).toBe("Current category is Games, the list you're importing is from Movies.")
    // Both names stand out, in the note's own font.
    expect([...note.querySelectorAll('strong')].map((name) => name.textContent)).toEqual([
      'Games',
      'Movies',
    ])
    expect(api.createFromFile).not.toHaveBeenCalled()

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L9'))
    expect(api.createFromFile).toHaveBeenCalledWith({ yaml: YAML })
  })

  it('Back closes the question and keeps the text, importing nothing (U3)', () => {
    renderTab(vi.fn(), 'game')

    fireEvent.change(box(), { target: { value: YAML } })
    fireEvent.click(importButton())
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Back' }))

    expect(screen.queryByText('Import to Movies?')).toBeNull()
    expect(box().value).toBe(YAML)
    expect(api.createFromFile).not.toHaveBeenCalled()
  })

  it('leaves an unknown category or unreadable text to the server to refuse (U3)', async () => {
    vi.mocked(api.createFromFile).mockRejectedValue(new Error('Unknown category "comics".'))
    renderTab(vi.fn(), 'game')

    fireEvent.change(box(), { target: { value: 'title: X\ncategory: comics\n' } })
    fireEvent.click(importButton())
    await waitFor(() => expect(screen.getByText('Unknown category "comics".')).not.toBeNull())

    fireEvent.change(box(), { target: { value: 'title: [unclosed' } })
    fireEvent.click(importButton())
    await waitFor(() => expect(api.createFromFile).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('peeks the category a file names, if it can read one', () => {
    expect(peekCategory(YAML)).toBe('movie')
    expect(peekCategory('title: X\n')).toBeUndefined()
    expect(peekCategory('category: [movie]\n')).toBeUndefined()
    expect(peekCategory('title: [unclosed')).toBeUndefined()
    expect(peekCategory('- a list\n')).toBeUndefined()
  })

  it('locks everything while importing', async () => {
    let finish: (value: never) => void = () => {}
    vi.mocked(api.createFromFile).mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderTab()

    fireEvent.change(box(), { target: { value: YAML } })
    fireEvent.click(importButton())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Importing…' })).toBeTruthy())
    expect(box().readOnly).toBe(true)
    expect((screen.getByRole('button', { name: 'Choose file…' }) as HTMLButtonElement).disabled).toBe(true)
    finish({ id: 'x' } as never)
  })

  it('refuses in one sentence, keeps the text, and clears on the next edit', async () => {
    vi.mocked(api.createFromFile).mockRejectedValue(
      new ApiError('Syntax error on line 42, list cannot be imported.', 400, 'list.fileSyntax'),
    )
    const onBuilt = renderTab()

    fireEvent.change(box(), { target: { value: 'bad' } })
    fireEvent.click(importButton())

    expect(await screen.findByText('Syntax error on line 42, list cannot be imported.')).toBeTruthy()
    expect(box().value).toBe('bad')
    expect(onBuilt).not.toHaveBeenCalled()
    // Unlocked again, so it can be fixed.
    expect(box().readOnly).toBe(false)

    fireEvent.change(box(), { target: { value: 'better' } })
    expect(screen.queryByText(/Syntax error/)).toBeNull()
  })

  it('clears a refusal when another file is picked', async () => {
    vi.mocked(api.createFromFile).mockRejectedValue(new Error('No items found, list cannot be imported.'))
    renderTab()

    fireEvent.change(box(), { target: { value: 'x' } })
    fireEvent.click(importButton())
    await screen.findByText(/No items found/)

    chooseFile(YAML)
    await waitFor(() => expect(screen.queryByText(/No items found/)).toBeNull())
  })

  it('always says how lists travel', () => {
    renderTab()

    expect(
      screen.getByText(
        'Listulator lists travel as YAML files. Export writes one; Import reads it back as a new list.',
      ),
    ).toBeTruthy()
  })

  it('puts that line on the Import button’s own row, left of it (prototype, F7)', () => {
    renderTab()

    const row = screen.getByRole('button', { name: 'Import' }).parentElement!
    expect(row.textContent).toContain('Listulator lists travel as YAML files.')
  })
})
