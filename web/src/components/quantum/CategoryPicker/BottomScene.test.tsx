// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BottomScene, SCENES, pickScene } from './BottomScene.js'

afterEach(cleanup)

describe('pickScene (X-006: Choose Your Fighter’s bottom scene, one of two at random)', () => {
  it('is the 80s desk for the lower half of the random range and the fantasy landscape for the upper half', () => {
    expect(SCENES).toEqual(['desk', 'landscape'])
    expect([0, 0.1, 0.4999].map((value) => pickScene(() => value))).toEqual(['desk', 'desk', 'desk'])
    expect([0.5, 0.9, 0.9999].map((value) => pickScene(() => value))).toEqual(['landscape', 'landscape', 'landscape'])
  })
})

describe('BottomScene', () => {
  const scene = (container: HTMLElement) => container.querySelector('.q-scene-art')?.getAttribute('data-scene')

  it.each([
    [0.1, 'desk'],
    [0.9, 'landscape'],
  ])('shows the scene its pick chose (random %s: %s), as decoration hidden from assistive technology', (value, expected) => {
    const { container } = render(<BottomScene random={() => value} />)

    expect(scene(container)).toBe(expected)
    expect(container.querySelector('.q-scene')?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('.q-scene')?.childNodes).toHaveLength(1)
  })

  it('picks once per opening: a re-render shows the same scene and does not ask again', () => {
    const random = vi.fn(() => 0.1)
    const { container, rerender } = render(<BottomScene random={random} />)

    random.mockReturnValue(0.9)
    rerender(<BottomScene random={random} />)
    rerender(<BottomScene random={random} />)

    expect(scene(container)).toBe('desk')
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('picks again each time the screen is opened: a new mount asks again', () => {
    const random = vi.fn(() => 0.1)
    const first = render(<BottomScene random={random} />)
    expect(scene(first.container)).toBe('desk')
    first.unmount()

    random.mockReturnValue(0.9)
    const second = render(<BottomScene random={random} />)

    expect(scene(second.container)).toBe('landscape')
    expect(random).toHaveBeenCalledTimes(2)
  })

  it('uses Math.random when nothing is injected: either scene, never none', () => {
    const { container } = render(<BottomScene />)

    expect(SCENES).toContain(scene(container))
  })
})
