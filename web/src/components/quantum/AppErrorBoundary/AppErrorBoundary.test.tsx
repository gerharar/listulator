// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppErrorBoundary } from './AppErrorBoundary.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Boom(): never {
  throw new Error('kaboom')
}

describe('AppErrorBoundary', () => {
  it('shows the app as usual when nothing goes wrong', () => {
    render(
      <AppErrorBoundary>
        <p>All fine</p>
      </AppErrorBoundary>,
    )

    expect(screen.getByText('All fine')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('replaces a crashed app with a message and a Reload button, instead of a blank window', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    render(
      <AppErrorBoundary onReload={reload}>
        <Boom />
      </AppErrorBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Something went wrong. Pantshitality!')
    expect(alert.textContent).toContain('your lists are not affected')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('keeps the error in the console for whoever investigates', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <AppErrorBoundary onReload={vi.fn()}>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(logged.mock.calls.some((call) => call.some((arg) => arg instanceof Error && arg.message === 'kaboom'))).toBe(true)
  })
})
