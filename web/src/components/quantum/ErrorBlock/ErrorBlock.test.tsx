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
