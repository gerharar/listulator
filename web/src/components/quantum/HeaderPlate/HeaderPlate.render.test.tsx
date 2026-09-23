// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { HeaderPlate } from './HeaderPlate.js'

afterEach(cleanup)

describe('HeaderPlate rendering', () => {
  it('carries data-side and --sd, with no data-marks by default', () => {
    const { container } = render(<HeaderPlate side="right" seed={3} />)
    const plate = container.querySelector('.q-plate')!

    expect(plate.getAttribute('data-side')).toBe('right')
    expect(plate.getAttribute('style')).toContain('--sd: 3')
    expect(plate.hasAttribute('data-marks')).toBe(false)
  })

  it('sets data-marks when marks is on', () => {
    const { container } = render(<HeaderPlate side="left" seed={0} marks />)

    expect(container.querySelector('.q-plate')!.hasAttribute('data-marks')).toBe(true)
  })

  it('adds the q-wash class for a helper sheet, still with the h/a1/a2 children the CSS hides', () => {
    const { container } = render(<HeaderPlate side="left" seed={6} wash />)
    const plate = container.querySelector('.q-plate')!

    expect(plate.className).toContain('q-wash')
    expect(plate.querySelectorAll('i')).toHaveLength(3)
  })
})
