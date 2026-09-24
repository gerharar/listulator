// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useQRootElement, QRoot } from './QRootContext.js'

afterEach(cleanup)

describe('QRoot', () => {
  it('carries data-theme from the skin prop', () => {
    const { container } = render(
      <QRoot skin="dark-blue">
        <span>content</span>
      </QRoot>,
    )

    expect(container.querySelector('.q-root')?.getAttribute('data-theme')).toBe('dark-blue')
  })

  it('provides its own element to useQRootElement, once mounted', () => {
    let seen: HTMLElement | null | undefined = 'not called' as unknown as null

    function Reader() {
      seen = useQRootElement()
      return null
    }

    const { container } = render(
      <QRoot skin="dark-orange">
        <Reader />
      </QRoot>,
    )

    expect(seen).toBe(container.querySelector('.q-root'))
  })
})

describe('useQRootElement outside any QRoot', () => {
  it('is undefined — a portal can tell "no QRoot at all" apart from "QRoot exists but has not attached its ref yet"', () => {
    let seen: HTMLElement | null | undefined = 'not called' as unknown as null

    function Reader() {
      seen = useQRootElement()
      return null
    }

    render(<Reader />)

    expect(seen).toBeUndefined()
  })
})
