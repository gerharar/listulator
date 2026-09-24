// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorStrip } from './ErrorStrip.js'

afterEach(cleanup)

describe('ErrorStrip', () => {
  it('shows the one-line message with Retry and Dismiss', () => {
    render(<ErrorStrip message="MusicBrainz is rate-limiting us." onRetry={() => {}} onDismiss={() => {}} />)

    expect(screen.getByText('MusicBrainz is rate-limiting us.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
  })

  it('calls back for each action', () => {
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(<ErrorStrip message="x" onRetry={onRetry} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('is announced when it appears, since nothing else moves focus to it', () => {
    render(<ErrorStrip message="x" onRetry={() => {}} onDismiss={() => {}} />)

    expect(screen.getByRole('alert')).not.toBeNull()
  })
})
