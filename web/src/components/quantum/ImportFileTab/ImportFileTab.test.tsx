// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiError, api } from '../../../lib/api.js'
import { ImportFileTab } from './ImportFileTab.js'

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
const importButton = () => screen.getByRole('button', { name: /^Import/ }) as HTMLButtonElement

function chooseFile(text: string, name = 'comfort-rewatches.yaml', size = text.length) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = { name, size, text: async () => text } as unknown as File
  fireEvent.change(input, { target: { files: [file] } })
}

function renderTab(onBuilt = vi.fn()) {
  render(<ImportFileTab onBuilt={onBuilt} />)
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
})
