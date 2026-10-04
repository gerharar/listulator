// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SearchResultsStop } from './SearchResultsStop.js'

afterEach(cleanup)

function renderStop(overrides: Partial<Parameters<typeof SearchResultsStop>[0]> = {}) {
  const props = { shown: 20, loadingMore: false, onRefine: vi.fn(), onShowMore: vi.fn(), ...overrides }
  render(<SearchResultsStop {...props} />)

  return props
}

describe('SearchResultsStop (design 5A)', () => {
  it('closes the list with the caption, the note and the two actions, Refine first', () => {
    renderStop({ shown: 40 })

    expect(screen.getByText('End of first 40')).not.toBeNull()
    expect(
      screen.getByText(
        'More matches found. Refine your search to improve results — add a year, a word from the title, or pick a narrower category',
      ),
    ).not.toBeNull()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Refine search', 'Show more'])
  })

  it('calls back for each action', () => {
    const { onRefine, onShowMore } = renderStop()

    fireEvent.click(screen.getByRole('button', { name: 'Refine search' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(onRefine).toHaveBeenCalledTimes(1)
    expect(onShowMore).toHaveBeenCalledTimes(1)
  })

  it('while the next rows load, Show more says so and is locked; Refine stays usable', () => {
    const { onShowMore } = renderStop({ loadingMore: true })

    const loading = screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement
    fireEvent.click(loading)

    expect(loading.disabled).toBe(true)
    expect(onShowMore).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Refine search' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('locks both actions while the tab is busy with an import', () => {
    const { onRefine, onShowMore } = renderStop({ locked: true })

    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(onRefine).not.toHaveBeenCalled()
    expect(onShowMore).not.toHaveBeenCalled()
  })

  it('never looks like a row: no expand control, no count', () => {
    const { container } = render(<SearchResultsStop shown={20} loadingMore={false} onRefine={() => {}} onShowMore={() => {}} />)

    expect(container.querySelector('[aria-expanded]')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })
})
