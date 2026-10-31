// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ProgressSentence } from './ProgressSentence.js'

afterEach(cleanup)

function renderSentence(size: 'header' | 'group' = 'header', total = 38) {
  render(
    <OverlayManagerProvider>
      <ProgressSentence done={16} total={total} minutesLeft={883} status={null} size={size} />
    </OverlayManagerProvider>,
  )
}

/**
 * H-024 (owner, 2026-10-31): with 20 cells always and the percentage beside them there is nothing to explain, so
 * the header bar is a plain bar again: no button, no popover, not in the tab order.
 */
describe('the header meter bar is a plain bar (H-024: its click-for-help popover is gone)', () => {
  it.each(['header', 'group'] as const)('is no button at %s size, and is not in the tab order', (size) => {
    renderSentence(size)

    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('.q-meter-explain')).toBeNull()
    expect(document.querySelector('[tabindex]')).toBeNull()
  })

  it('still names itself for a screen reader with the real numbers', () => {
    renderSentence('header')

    expect(screen.getByRole('img', { name: '16 of 38 done' })).toBeTruthy()
  })

  it('opens nothing when the bar is clicked', () => {
    renderSentence('header')
    fireEvent.click(screen.getByRole('img', { name: '16 of 38 done' }))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has no hint or explanation text left for the cells', () => {
    renderSentence('header')

    expect(screen.queryByLabelText('How progress bar cells work')).toBeNull()
    expect(document.body.textContent).not.toContain('One cell = one item')
    expect(document.body.textContent).not.toMatch(/cells ≈/)
  })
})
