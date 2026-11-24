// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MeterBar } from './MeterBar.js'

afterEach(cleanup)

/**
 * A bar that BECOMES finished says so (57.11b; eX-Zed draws one FLASH step there, then the stripe, `exzed-progress.css`): `data-just-finished` is on from the render that finishes it until it
 * is no longer finished. A bar that is drawn already finished (opening a list, switching a theme) never flashes: nothing was done.
 */
describe('MeterBar: the step into finished', () => {
  const bar = (container: HTMLElement) => container.querySelector('.q-meter')!

  it('does not flash a bar that is finished from its first draw', () => {
    const { container } = render(<MeterBar done={4} total={4} />)

    expect(bar(container).classList.contains('full')).toBe(true)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(false)
  })

  it('flashes the bar the moment the last item is done, and keeps the mark while it stays finished', () => {
    const { container, rerender } = render(<MeterBar done={3} total={4} />)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(false)

    rerender(<MeterBar done={4} total={4} />)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(true)

    rerender(<MeterBar done={4} total={4} big />)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(true)
  })

  it('takes the mark away when the list is no longer finished, and flashes again the next time', () => {
    const { container, rerender } = render(<MeterBar done={3} total={4} />)
    rerender(<MeterBar done={4} total={4} />)
    rerender(<MeterBar done={3} total={4} />)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(false)

    rerender(<MeterBar done={4} total={4} />)
    expect(bar(container).hasAttribute('data-just-finished')).toBe(true)
  })

  it('never flashes an empty list or one that only grows', () => {
    const { container, rerender } = render(<MeterBar done={0} total={0} />)
    rerender(<MeterBar done={0} total={5} />)
    rerender(<MeterBar done={2} total={5} />)

    expect(bar(container).hasAttribute('data-just-finished')).toBe(false)
  })
})
