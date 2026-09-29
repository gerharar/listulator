// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { ProgressSentence } from './ProgressSentence.js'

afterEach(cleanup)

function renderSentence(size: 'header' | 'row' | 'group' = 'header', total = 38) {
  render(
    <OverlayManagerProvider>
      <ProgressSentence done={16} total={total} minutesLeft={883} status={null} size={size} />
    </OverlayManagerProvider>,
  )
}

/**
 * The header meter bar is the one place the design gives a click hint (prototype:
 * a button titled "How progress bar cells work", opening what a cell stands for). The
 * row and group bars stay plain — the prototype never makes them a button.
 */
describe('the header meter bar hints that it opens an explanation (owner: matches the prototype)', () => {
  const button = () => screen.getByRole('button', { name: 'How progress bar cells work' })

  it('is a button, not just a bar, only at header size', () => {
    renderSentence('header')
    expect(button()).toBeTruthy()

    cleanup()
    renderSentence('row')
    expect(screen.queryByRole('button', { name: 'How progress bar cells work' })).toBeNull()

    cleanup()
    renderSentence('group')
    expect(screen.queryByRole('button', { name: 'How progress bar cells work' })).toBeNull()
  })

  it('opens on click, with the short note first and the long one under it, and closes on a second click', () => {
    renderSentence('header')
    fireEvent.click(button())

    const pop = screen.getByRole('dialog', { name: 'How progress bar cells work' })
    expect(pop.textContent).toContain('20 cells ≈ 2 items each')
    expect(pop.textContent).toContain(
      'The bar caps at 20 cells, so each cell stands for about 2 items.',
    )

    fireEvent.click(button())
    expect(screen.queryByRole('dialog', { name: 'How progress bar cells work' })).toBeNull()
  })

  it('says it plainly under the cap: one cell is one item', () => {
    renderSentence('header', 12)
    fireEvent.click(button())

    const pop = screen.getByRole('dialog', { name: 'How progress bar cells work' })
    expect(pop.textContent).toContain('One cell = one item')
    expect(pop.textContent).toContain('Each cell is one item in this list. Filled cell = done.')
  })

  it('closes on a click away', () => {
    renderSentence('header')
    fireEvent.click(button())
    fireEvent.click(document.querySelector('.q-catcher')!)

    expect(screen.queryByRole('dialog', { name: 'How progress bar cells work' })).toBeNull()
  })
})
