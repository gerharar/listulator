// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UpdatesCard, type UpdatesCardProps } from './UpdatesCard.js'

afterEach(cleanup)

const titles = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Episode ${i + 1}` }))

function renderCard(overrides: Partial<UpdatesCardProps> = {}) {
  const props: UpdatesCardProps = {
    result: { newItems: titles(3), upstreamCount: 20, existingCount: 17, dismissedCount: 0 },
    includeDismissed: false,
    adding: false,
    onIncludeDismissedChange: vi.fn(),
    onAdd: vi.fn(),
    ...overrides,
  }
  render(<UpdatesCard {...props} />)
  return props
}

describe('UpdatesCard', () => {
  it('says how many entries are new and names them', () => {
    renderCard()

    expect(screen.getByText(/3 entries/)).toBeTruthy()
    expect(screen.getByText(/Episode 1 · Episode 2 · Episode 3/)).toBeTruthy()
  })

  it('names twelve and counts the rest', () => {
    renderCard({
      result: { newItems: titles(15), upstreamCount: 40, existingCount: 25, dismissedCount: 0 },
    })

    expect(screen.getByText(/Episode 12/)).toBeTruthy()
    expect(screen.queryByText(/Episode 13/)).toBeNull()
    expect(screen.getByText(/and 3 more/)).toBeTruthy()
  })

  it('adds them only when asked', () => {
    const { onAdd } = renderCard()
    expect(onAdd).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add 3 to this list' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('locks the button while adding', () => {
    renderCard({ adding: true })

    expect(screen.getByRole('button', { name: /Add 3|Adding/ }).hasAttribute('disabled')).toBe(true)
  })

  it('says the list is up to date, with no button, when nothing is new', () => {
    renderCard({
      result: { newItems: [], upstreamCount: 20, existingCount: 20, dismissedCount: 0 },
    })

    expect(screen.getByText(/Up to date/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull()
  })

  it('says how many deleted entries are being held back', () => {
    renderCard({
      result: { newItems: [], upstreamCount: 20, existingCount: 18, dismissedCount: 2 },
    })

    expect(screen.getByText(/2 entries you deleted are being held back/)).toBeTruthy()
  })

  it('does not claim entries are held back when deleted entries are included', () => {
    renderCard({
      includeDismissed: true,
      result: { newItems: [], upstreamCount: 20, existingCount: 18, dismissedCount: 2 },
    })

    expect(screen.queryByText(/held back/)).toBeNull()
  })

  it('offers to include deleted entries, and reports the choice', () => {
    const { onIncludeDismissedChange } = renderCard()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Re-add deleted entries' }))

    expect(onIncludeDismissedChange).toHaveBeenCalledWith(true)
  })

  it('calls them things to put back when deleted entries are included', () => {
    renderCard({ includeDismissed: true })

    expect(screen.getByText(/to put back/)).toBeTruthy()
  })
})
