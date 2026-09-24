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
})
