// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { LiveRegionProvider } from '../LiveRegion/LiveRegion.js'
import { ToastProvider, useToast, type ToastContextValue } from './Toast.js'

/** A sticky toast (H-012): says what is happening while a long run goes on, until the run ends. */

let toasts: ToastContextValue

function Grab() {
  toasts = useToast()

  return null
}

function mount() {
  render(
    <LiveRegionProvider>
      <ToastProvider>
        <Grab />
      </ToastProvider>
    </LiveRegionProvider>,
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
})
