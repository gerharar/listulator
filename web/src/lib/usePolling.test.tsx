// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { usePolling } from './usePolling.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Probe({ active, tick }: { active: boolean; tick: () => void | Promise<void> }) {
  usePolling(active, tick, 3000)

  return null
}

const advance = async (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('usePolling (15.7)', () => {
  it('calls back every interval while active, and not at all while inactive', async () => {
    const tick = vi.fn()
    const view = render(<Probe active={false} tick={tick} />)

    await advance(10_000)
    expect(tick).not.toHaveBeenCalled()

    view.rerender(<Probe active tick={tick} />)
    await advance(3000)
    expect(tick).toHaveBeenCalledTimes(1)
    await advance(6000)
    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('stops when it becomes inactive, and when the component goes', async () => {
    const tick = vi.fn()
    const view = render(<Probe active tick={tick} />)
    await advance(3000)

    view.rerender(<Probe active={false} tick={tick} />)
    await advance(9000)
    expect(tick).toHaveBeenCalledTimes(1)

    view.rerender(<Probe active tick={tick} />)
    view.unmount()
    await advance(9000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('does not call while the page is hidden, and carries on when it is shown again', async () => {
    const tick = vi.fn()
    render(<Probe active tick={tick} />)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })

    await advance(9000)
    expect(tick).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    await advance(3000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('does not start another call while the last is still running', async () => {
    let finish!: () => void
    const tick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    render(<Probe active tick={tick} />)

    await advance(9000)
    expect(tick).toHaveBeenCalledTimes(1)

    finish()
    await advance(3000)
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('uses the latest callback without restarting the clock', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Probe active tick={first} />)
    await advance(2000)

    view.rerender(<Probe active tick={second} />)
    await advance(1000)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('survives a callback that fails, and keeps going', async () => {
    const tick = vi.fn(async () => {
      throw new Error('offline')
    })
    render(<Probe active tick={tick} />)

    await advance(6000)

    expect(tick).toHaveBeenCalledTimes(2)
  })
})
