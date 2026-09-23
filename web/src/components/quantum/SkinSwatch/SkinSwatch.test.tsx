// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SkinSwatch } from './SkinSwatch.js'

afterEach(cleanup)

describe('SkinSwatch', () => {
  it('always carries data-theme for its own skin, never the active one', () => {
    const { container } = render(<SkinSwatch skin="dark-blue" />)

    expect(container.querySelector('.q-hex')!.getAttribute('data-theme')).toBe('dark-blue')
  })

  it('is the 20px default, or 16px small', () => {
    const { container: header } = render(<SkinSwatch skin="light-bone" />)
    expect(header.querySelector('.q-hex')!.className).toBe('q-hex')

    const { container: menu } = render(<SkinSwatch skin="light-bone" small />)
    expect(menu.querySelector('.q-hex')!.className).toBe('q-hex sm')
  })
})
