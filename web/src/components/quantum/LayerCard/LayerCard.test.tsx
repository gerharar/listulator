// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LayerCard } from './LayerCard.js'

afterEach(cleanup)

describe('LayerCard', () => {
  it('renders its body, and no head when none is given', () => {
    const { container } = render(<LayerCard>content</LayerCard>)

    expect(screen.getByText('content')).not.toBeNull()
    expect(container.querySelector('.q-layer-head')).toBeNull()
  })

  it('renders a head block when given one', () => {
    render(<LayerCard head={<h1>Title</h1>}>content</LayerCard>)

    expect(screen.getByText('Title')).not.toBeNull()
  })

  it('shows no tab or veil when not covered', () => {
    const { container } = render(<LayerCard>content</LayerCard>)

    expect(container.querySelector('.q-layer-tab')).toBeNull()
    expect(container.querySelector('.q-veil')).toBeNull()
  })

  it('shows the tab and veil, with the tab label, once covered', () => {
    render(
      <LayerCard covered tabLabel="My Lists">
        content
      </LayerCard>,
    )

    expect(screen.getByText('My Lists')).not.toBeNull()
    expect(document.querySelector('.q-veil')).not.toBeNull()
  })

  it('plays the drum-in animation only when entering', () => {
    const { container, rerender } = render(<LayerCard>content</LayerCard>)
    expect(container.querySelector('.q-layer')?.className).not.toMatch(/\benter\b/)

    rerender(<LayerCard entering>content</LayerCard>)
    expect(container.querySelector('.q-layer')?.className).toMatch(/\benter\b/)
  })

  it('the tab jumps to this layer; the veil just dismisses one', () => {
    const onTabClick = vi.fn()
    const onVeilClick = vi.fn()
    render(
      <LayerCard covered tabLabel="My Lists" onTabClick={onTabClick} onVeilClick={onVeilClick}>
        content
      </LayerCard>,
    )

    screen.getByRole('button', { name: 'My Lists' }).click()
    expect(onTabClick).toHaveBeenCalledOnce()
    expect(onVeilClick).not.toHaveBeenCalled()

    document.querySelector<HTMLElement>('.q-veil')?.click()
    expect(onVeilClick).toHaveBeenCalledOnce()
  })
})
