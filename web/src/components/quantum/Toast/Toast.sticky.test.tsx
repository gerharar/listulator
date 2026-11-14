// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { ToastProvider, useToast, type ToastContextValue } from './Toast.js'

/** A sticky toast (H-012): says what is happening while a long run goes on, until the run ends. */

let toasts: ToastContextValue

function Grab() {
  toasts = useToast()

  return null
}

function mount(theme: 'quantum' | 'exzed' = 'quantum') {
  render(
    <ThemeContext.Provider value={theme}>
      <LiveRegionProvider>
        <ToastProvider>
          <Grab />
        </ToastProvider>
      </LiveRegionProvider>
    </ThemeContext.Provider>,
  )
}

const toast = () => document.querySelector('.q-toast') as HTMLElement | null
const live = () => document.querySelector('.q-live')!.textContent

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('a sticky toast', () => {
  it('stays until it is hidden, however long the run, with no action and no timer', () => {
    vi.useFakeTimers()
    mount()

    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))
    act(() => void vi.advanceTimersByTime(60_000))

    expect(toast()!.textContent).toBe('Resetting the list…')
    expect(toast()!.querySelector('button')).toBeNull()
  })

  it('is said once in the live region', () => {
    vi.useFakeTimers()
    mount()

    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))
    act(() => void vi.advanceTimersByTime(50))

    expect(live()).toBe('Resetting the list…')
  })

  it('is replaced by the next toast, which then times out as usual', () => {
    vi.useFakeTimers()
    mount()
    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))

    act(() => toasts.showToast({ text: 'Reset undone' }))
    expect(toast()!.textContent).toBe('Reset undone')
    act(() => void vi.advanceTimersByTime(3100))

    expect(toast()).toBeNull()
  })

  it('hideToast takes a sticky toast away', () => {
    mount()
    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))

    act(() => toasts.hideToast())

    expect(toast()).toBeNull()
  })

  it('hideToast leaves any other toast alone: a result that has already replaced the sticky one stays', () => {
    vi.useFakeTimers()
    mount()
    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))
    act(() => toasts.showToast({ text: 'List was reset', actionLabel: 'Undo', onAction: () => {} }))

    act(() => toasts.hideToast())

    expect(toast()!.textContent).toMatch(/List was reset/)
  })

  it('shows the spinner beside its sentence under eX-Zed only, and the spinner is not said again', () => {
    mount('exzed')
    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))

    const spinner = toast()!.querySelector('.q-spinner')
    expect(spinner).not.toBeNull()
    expect(spinner!.getAttribute('aria-hidden')).toBe('true')
    expect(toast()!.querySelectorAll('.q-spinner rect')).toHaveLength(8)
    act(() => toasts.showToast({ text: 'List was reset' }))
    expect(toast()!.querySelector('.q-spinner')).toBeNull()
  })

  it('has no spinner under Quantum', () => {
    mount()
    act(() => toasts.showToast({ text: 'Resetting the list…', sticky: true }))

    expect(toast()!.querySelector('.q-spinner')).toBeNull()
  })
})
