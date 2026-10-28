// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { GroupLineProvider, GroupTriangle } from './GroupTriangle.js'

afterEach(cleanup)

/** Canvas H-022: the group triangle as a drawn shape with a 1px line, behind the `markOpenGroups` preference. */
describe('GroupTriangle', () => {
  it('is today\'s glyph exactly while the preference is off (the default): one ▼ in `.q-chev`, no drawing, no line', () => {
    const { container } = render(<GroupTriangle />)

    const chev = container.querySelector('.q-chev')!
    expect(chev.tagName).toBe('SPAN')
    expect(chev.textContent).toBe('▼')
    expect(chev.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('.q-chev-rule')).toBeNull()
  })

  it('draws the 14 x 12 triangle and the line, and no glyph, when the preference is on', () => {
    const { container } = render(
      <GroupLineProvider on>
        <GroupTriangle />
      </GroupLineProvider>,
    )

    const root = container.querySelector('.q-chev-line')!
    expect(root.getAttribute('aria-hidden')).toBe('true')
    expect(root.textContent).toBe('')
    expect(container.querySelector('.q-chev')).toBeNull()
    const svg = root.querySelector('svg.q-chev-tri')!
    expect(svg.getAttribute('width')).toBe('14')
    expect(svg.getAttribute('height')).toBe('12')
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M0 0H14L7 12Z')
    expect(svg.querySelector('path')!.getAttribute('fill')).toBe('currentColor')
    expect(root.querySelector('.q-chev-rule')).not.toBeNull()
  })

  it('is off for a provider that says off', () => {
    const { container } = render(
      <GroupLineProvider on={false}>
        <GroupTriangle />
      </GroupLineProvider>,
    )

    expect(container.querySelector('.q-chev')!.textContent).toBe('▼')
    expect(container.querySelector('svg')).toBeNull()
  })
})
