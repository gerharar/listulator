// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MediaType } from '../../../lib/api.js'
import { api } from '../../../lib/api.js'
import { AddByHandTab } from './AddByHandTab.js'

vi.mock('../../../lib/api.js', () => ({
  api: { createList: vi.fn(), importItems: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const BOOKS: MediaType = {
  key: 'book',
  label: 'Books',
  sortOrder: 10,
  defaultDurationMinutes: 480,
  searchAvailable: false,
  previewable: false,
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function renderTab(onBuilt = vi.fn()) {
  render(<AddByHandTab mediaType={BOOKS} onBuilt={onBuilt} />)
  return onBuilt
}

describe('AddByHandTab', () => {
  it('stops typing at 255 characters in the list title: the limit on names', () => {
    renderTab()

    expect((screen.getByLabelText('Title') as HTMLInputElement).maxLength).toBe(255)
  })

  it('turns spellcheck off for titles and items, and leaves it on for the description', () => {
    // jsdom has no `spellcheck` property, so the attribute is what is read.
    renderTab()

    expect(screen.getByLabelText('Title').getAttribute('spellcheck')).toBe('false')
    expect(screen.getByLabelText('Items').getAttribute('spellcheck')).toBe('false')
    expect(screen.getByLabelText('Description').getAttribute('spellcheck')).toBeNull()
  })

  it('cannot create without a title', () => {
    renderTab()

    expect(screen.getByRole('button', { name: 'Create List' })).toHaveProperty('disabled', true)
    type('Title', 'My list')
    expect(screen.getByRole('button', { name: 'Create List' })).toHaveProperty('disabled', false)
  })

  it('counts items and groups as you type', () => {
    renderTab()

    expect(screen.getByText(/No items \(can add later\)/)).toBeTruthy()
    type('Items', 'Early:\nA\nB\nLate:\nC')
    expect(screen.getByText(/^3 items in 2 groups/)).toBeTruthy()
  })

  it('creates the list with its description, status and grouped items, then opens it', async () => {
    vi.mocked(api.createList).mockResolvedValue({ id: 'L1' } as never)
    vi.mocked(api.importItems).mockResolvedValue([])
    const onBuilt = renderTab()

    type('Title', '  Jackie  ')
    type('Description', 'His films')
    type('Items', 'Early:\nDrunken Master\nLate:\nRush Hour')
    fireEvent.click(screen.getByRole('button', { name: 'Ongoing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create List' }))

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L1'))
    expect(api.createList).toHaveBeenCalledWith({
      title: 'Jackie',
      mediaType: 'book',
      description: 'His films',
      status: 'ongoing',
    })
    expect(api.importItems).toHaveBeenCalledWith(
      'L1',
      [
        { title: 'Drunken Master', group: 'Early' },
        { title: 'Rush Hour', group: 'Late' },
      ],
      'manual',
    )
  })

  it('sends no description and no status when left alone, and skips the import with no items', async () => {
    vi.mocked(api.createList).mockResolvedValue({ id: 'L2' } as never)
    const onBuilt = renderTab()

    type('Title', 'Empty')
    fireEvent.click(screen.getByRole('button', { name: 'Create List' }))

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L2'))
    expect(api.createList).toHaveBeenCalledWith({
      title: 'Empty',
      mediaType: 'book',
      description: null,
      status: null,
    })
    expect(api.importItems).not.toHaveBeenCalled()
  })

  it('does not submit when a status button is clicked', () => {
    renderTab()

    type('Title', 'X')
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))

    expect(api.createList).not.toHaveBeenCalled()
  })

  it('says so on failure, and Retry does not make a second list', async () => {
    vi.mocked(api.createList).mockResolvedValue({ id: 'L3' } as never)
    vi.mocked(api.importItems).mockRejectedValueOnce(new Error('Server said no'))
    vi.mocked(api.importItems).mockResolvedValueOnce([])
    const onBuilt = renderTab()

    type('Title', 'Half made')
    type('Items', 'A')
    fireEvent.click(screen.getByRole('button', { name: 'Create List' }))

    expect(await screen.findByText('Server said no')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(onBuilt).toHaveBeenCalledWith('L3'))
    expect(api.createList).toHaveBeenCalledTimes(1)
    expect(api.importItems).toHaveBeenCalledTimes(2)
  })

  it('shows the category’s own examples, not one film director’s for every category (11.16)', () => {
    renderTab()

    expect((screen.getByLabelText('Title') as HTMLInputElement).placeholder).toBe('Discworld novels')
    expect((screen.getByLabelText('Items') as HTMLTextAreaElement).placeholder).toContain('Rincewind:')
    expect(screen.getByText(/One book per line/)).toBeTruthy()
  })
})

