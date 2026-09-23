// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Atmosphere } from './Atmosphere.js'

afterEach(cleanup)

describe('Atmosphere', () => {
  it('renders the seven layers in order: wash, fine, coarse, hatch, ring1, ring2, ruler', () => {
    const { container } = render(<Atmosphere />)
    const atmo = container.querySelector('.q-atmo')!
    const layers = [...atmo.children].map((el) => el.className)

    expect(layers).toEqual(['wash', 'fine', 'coarse', 'hatch', 'ring1', 'ring2', 'ruler'])
  })

  it('is hidden from assistive tech — it is decoration, not content', () => {
    const { container } = render(<Atmosphere />)

    expect(container.querySelector('.q-atmo')!.getAttribute('aria-hidden')).toBe('true')
  })
})
