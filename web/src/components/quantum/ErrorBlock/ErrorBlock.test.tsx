// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ErrorBlock } from './ErrorBlock.js'

afterEach(cleanup)

describe('ErrorBlock', () => {
  it('shows the headline and explanation', () => {
    render(<ErrorBlock headline="Could not load your lists" explanation="Cannot reach the server." />)

    expect(screen.getByText('Could not load your lists')).not.toBeNull()
    expect(screen.getByText('Cannot reach the server.')).not.toBeNull()
  })

  it('draws no explanation paragraph when there is none, so the headline sits centred (owner, 2026-10-05)', () => {
    // An empty <p> kept its 7 px top margin: 18 px above the headline, 25 px below, the text 7 px high.
    const { container } = render(<ErrorBlock headline="Nothing to add" />)
    const { container: blank } = render(<ErrorBlock headline="Nothing to add" explanation="" />)

    expect(container.querySelector('p')).toBeNull()
    expect(blank.querySelector('p')).toBeNull()
  })

  it('renders no action when none is given', () => {
    render(<ErrorBlock headline="Broken" explanation="Something failed." />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders at most one action, wired to its own handler', () => {
    const onRetry = vi.fn()
    render(
      <ErrorBlock
        headline="Broken"
        explanation="Something failed."
        action={{ label: 'Retry', onClick: onRetry }}
      />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)

    buttons[0]?.click()
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
