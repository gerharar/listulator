// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ThemeContext } from '../DocumentTheme/ThemeContext.js'
import { Spinner } from './Spinner.js'

afterEach(cleanup)

describe('the spinner', () => {
  it('is a labelled status with no drawing of its own under Quantum: the ring is the stylesheet’s', () => {
    const { container } = render(<Spinner label="Searching" />)
    const spinner = container.querySelector('.q-spinner')!

    expect(spinner.getAttribute('role')).toBe('status')
    expect(spinner.getAttribute('aria-label')).toBe('Searching')
    expect(spinner.querySelector('svg')).toBeNull()
  })

  it('is eight 2x2 cells on a 12-unit ring under eX-Zed, clockwise from the top', () => {
    const { container } = render(
      <ThemeContext.Provider value="exzed">
        <Spinner label="Searching" />
      </ThemeContext.Provider>,
    )
    const cells = [...container.querySelectorAll('.q-spinner svg rect')].map((rect) => [rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height')].join(','))

    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 12 12')
    expect(cells).toEqual(['5,0,2,2', '8,2,2,2', '10,5,2,2', '8,8,2,2', '5,10,2,2', '2,8,2,2', '0,5,2,2', '2,2,2,2'])
  })

  it('is hidden from assistive tech when it is beside a sentence that says it', () => {
    const { container } = render(<Spinner label="Resetting" decorative />)
    const spinner = container.querySelector('.q-spinner')!

    expect(spinner.getAttribute('aria-hidden')).toBe('true')
    expect(spinner.getAttribute('role')).toBeNull()
    expect(spinner.getAttribute('aria-label')).toBeNull()
  })
})
