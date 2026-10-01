// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SearchResultRow, type SearchResultRowProps } from './SearchResultRow.js'

afterEach(cleanup)

function renderRow(overrides: Partial<SearchResultRowProps> = {}) {
  const props: SearchResultRowProps = {
    title: 'Star Wars: Main Saga',
    meta: 'Collection · TMDB',
    curated: false,
    expanded: false,
    onToggle: () => {},
    provenance: 'From TMDB',
    previewable: true,
    busy: false,
    onAdd: () => {},
    onPreview: () => {},
    ...overrides,
  }

  return { props, ...render(<SearchResultRow {...props} />) }
}

describe('SearchResultRow', () => {
  it('collapsed: title, meta line and no action buttons', () => {
    renderRow()

    expect(screen.getByText('Star Wars: Main Saga')).not.toBeNull()
    expect(screen.getByText('Collection · TMDB')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Add List' })).toBeNull()
    expect(screen.getByRole('button', { name: /Star Wars: Main Saga/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded: description, provenance, and Preview plus Add list', () => {
    renderRow({ expanded: true, description: 'The numbered films only.', provenance: 'From TMDB' })

    expect(screen.getByText('The numbered films only.')).not.toBeNull()
    expect(screen.getByText('From TMDB')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Preview' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add List' })).not.toBeNull()
    expect(screen.getByRole('button', { name: /Star Wars: Main Saga/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('draws the design’s filled triangles, ▶ folded and ▼ open, not a thin icon', () => {
    const { container, rerender, props } = renderRow()
    const chevron = () => container.querySelector('.chev')!

    expect(chevron().textContent).toBe('▶')
    expect(chevron().querySelector('svg')).toBeNull()

    rerender(<SearchResultRow {...props} expanded />)

    expect(chevron().textContent).toBe('▼')
    expect(chevron().querySelector('svg')).toBeNull()
  })

  it('toggles from a click and from Enter or Space, as a button would', () => {
    const onToggle = vi.fn()
    renderRow({ onToggle })
    const row = screen.getByRole('button', { name: /Star Wars: Main Saga/ })

    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(onToggle).toHaveBeenCalledTimes(3)
  })

  it('shows the item count with an ITEMS kicker once it has loaded', () => {
    renderRow({ expansion: { state: 'done', itemCount: 133 } })

    expect(screen.getByText('133')).not.toBeNull()
    expect(screen.getByText('items')).not.toBeNull()
  })

  it('shows a spinner, not a number, while the count loads', () => {
    renderRow({ expansion: { state: 'loading' } })

    expect(screen.getByRole('status', { name: 'Counting…' })).not.toBeNull()
    expect(screen.queryByText('items')).toBeNull()
  })

  it('shows neither a number nor a spinner nor an error for a failed count', () => {
    renderRow({ expansion: { state: 'failed' } })

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('items')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the status chip from the expansion when the result has none of its own', () => {
    renderRow({ expansion: { state: 'done', itemCount: 5, status: 'ongoing' } })

    expect(screen.getByText('Ongoing')).not.toBeNull()
  })

  it("prefers the result's own status (a curated file's) over the expansion's", () => {
    renderRow({ status: 'complete', expansion: { state: 'done', itemCount: 5, status: 'ongoing' } })

    expect(screen.getByText('Complete')).not.toBeNull()
    expect(screen.queryByText('Ongoing')).toBeNull()
  })

  it('marks a curated list with the star', () => {
    renderRow({ curated: true })

    expect(document.querySelector('.q-star')).not.toBeNull()
  })

  it('Preview calls back, and does not also toggle the row', () => {
    const onPreview = vi.fn()
    const onToggle = vi.fn()
    renderRow({ expanded: true, onPreview, onToggle })

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    expect(onPreview).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('Preview locks while an import runs', () => {
    renderRow({ expanded: true, busy: true })

    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a source that cannot enumerate before import says so in one line', () => {
    renderRow({ expanded: true, previewable: false })

    expect(screen.getByText(/too shy to list its items/)).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Add list calls back, and does not also toggle the row', () => {
    const onAdd = vi.fn()
    const onToggle = vi.fn()
    renderRow({ expanded: true, onAdd, onToggle })

    fireEvent.click(screen.getByRole('button', { name: 'Add List' }))

    expect(onAdd).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('locks Add list while an import is running', () => {
    renderRow({ expanded: true, busy: true })

    expect((screen.getByRole('button', { name: 'Add List' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Add list on a result known to hold nothing, and says why', () => {
    renderRow({ expanded: true, expansion: { state: 'done', itemCount: 0 } })

    const add = screen.getByRole('button', { name: 'Add List' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    // Its hover text (the app's tooltip, 11.19) is the same words, and assistive tech gets them as its description.
    expect(add.getAttribute('aria-description')).toBe('Curiously, this list has no items to add')
  })
})
