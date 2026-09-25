// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Banner } from './Banner.js'

afterEach(cleanup)

describe('Banner', () => {
  it('renders its sentence content', () => {
    render(
      <Banner onDismiss={vi.fn()} dismissLabel="Dismiss">
        <span>2 lists have updates available</span>
      </Banner>,
    )

    expect(screen.getByText('2 lists have updates available')).not.toBeNull()
  })

  it('dismisses on its own action, and nothing else', () => {
    const onDismiss = vi.fn()
    render(
      <Banner onDismiss={onDismiss} dismissLabel="Dismiss">
        <span>News</span>
      </Banner>,
    )

    screen.getByRole('button', { name: 'Dismiss' }).click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('can offer its action as a secondary button instead of a ghost one', () => {
    render(
      <Banner onDismiss={vi.fn()} dismissLabel="Mark all seen" actionVariant="secondary">
        <span>2 new items</span>
      </Banner>,
    )

    const button = screen.getByRole('button', { name: 'Mark all seen' })
    expect(button.classList.contains('ghost')).toBe(false)
  })

  it('offers a ghost button unless told otherwise', () => {
    render(
      <Banner onDismiss={vi.fn()} dismissLabel="Dismiss">
        <span>News</span>
      </Banner>,
    )

    expect(screen.getByRole('button', { name: 'Dismiss' }).classList.contains('ghost')).toBe(true)
  })
})
