// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { CategoryBanner } from './CategoryBanner.js'

afterEach(cleanup)

/** A finished list's header banner carries its four bands (57.11c, D64): a drawing inside the masked box the category's mask cuts; an unfinished list's has none; a tile never does. */
describe('CategoryBanner: the finished list', () => {
  it('draws the bands in the header banner of a finished list: 2px rows of four rects, in the art’s box', () => {
    const { container } = render(<CategoryBanner registryKey="movie" where="header" finished />)
    const banner = container.querySelector('.q-catbanner')!
    const bands = banner.querySelector('svg.q-catbanner-bands')!

    expect(banner.getAttribute('data-finished')).toBe('')
    expect([bands.getAttribute('width'), bands.getAttribute('height')]).toEqual(['386', '106'])
    expect(bands.getAttribute('shape-rendering')).toBe('crispEdges')
    expect(bands.querySelectorAll('rect')).toHaveLength(53 * 4)
  })

  it('draws nothing for a list that is not finished', () => {
    const { container } = render(<CategoryBanner registryKey="movie" where="header" />)

    expect(container.querySelector('.q-catbanner')!.hasAttribute('data-finished')).toBe(false)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('never draws them on a Choose Your Fighter tile', () => {
    const { container } = render(<CategoryBanner registryKey="movie" where="tile" finished />)

    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders nothing for a key with no banner, finished or not', () => {
    const { container } = render(<CategoryBanner registryKey="podcast" where="header" finished />)

    expect(container.innerHTML).toBe('')
  })
})
