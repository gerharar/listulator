// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Triangle, TRIANGLE_SIZES, type TriangleKind } from './Triangle.js'

afterEach(cleanup)

/**
 * Canvas H-027: every disclosure, picker and sort mark is one filled triangle, drawn (our fonts have no ▼ ▶ ▲, so each OS took them from a
 * different system font), in three sizes by role. Open and shut, sort up and down are the same drawing turned, not two characters.
 */
const KINDS: TriangleKind[] = ['section', 'row', 'picker']

function drawn(ui: React.ReactElement) {
  const { container } = render(ui)
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('no svg')

  return svg
}

describe('the sizes by role', () => {
  it('are the canvas’s: section fold 14 x 12, row fold 8 x 7, picker and sort 6 x 5', () => {
    expect(TRIANGLE_SIZES.section).toMatchObject({ width: 14, height: 12 })
    expect(TRIANGLE_SIZES.row).toMatchObject({ width: 8, height: 7 })
    expect(TRIANGLE_SIZES.picker).toMatchObject({ width: 6, height: 5 })
  })

  it('all have an even width, so the point lands on a whole pixel', () => {
    for (const kind of KINDS) expect(TRIANGLE_SIZES[kind].width % 2).toBe(0)
  })

  it('draw the row fold in an 8 x 8 box with the 8 x 7 ink at the top, so the quarter turn stays on whole pixels', () => {
    const svg = drawn(<Triangle kind="row" />)
    expect(svg.getAttribute('width')).toBe('8')
    expect(svg.getAttribute('height')).toBe('8')
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M0 0H8L4 7Z')
  })

  it.each([
    ['section', '14', '12', 'M0 0H14L7 12Z'],
    ['picker', '6', '5', 'M0 0H6L3 5Z'],
  ] as const)('draw the %s triangle in a box of its own size', (kind, width, height, path) => {
    const svg = drawn(<Triangle kind={kind} />)
    expect(svg.getAttribute('width')).toBe(width)
    expect(svg.getAttribute('height')).toBe(height)
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${width} ${height}`)
    expect(svg.querySelector('path')?.getAttribute('d')).toBe(path)
  })
})

describe('the drawing', () => {
  it.each(KINDS)('%s is filled with the text colour and has no stroke, so a skin colours it', (kind) => {
    const path = drawn(<Triangle kind={kind} />).querySelector('path')
    expect(path?.getAttribute('fill')).toBe('currentColor')
    expect(path?.getAttribute('stroke')).toBeNull()
  })

  it.each(KINDS)('%s is hidden from assistive technology and cannot take focus (the control keeps its own name)', (kind) => {
    const svg = drawn(<Triangle kind={kind} />)
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })

  it('holds no text glyph', () => {
    expect(drawn(<Triangle kind="section" />).textContent).toBe('')
  })

  it('passes a class on, after its own', () => {
    const svg = drawn(<Triangle kind="picker" className="q-skin-caret" />)
    expect(svg.getAttribute('class')).toBe('q-triangle q-skin-caret')
  })
})

describe('the directions', () => {
  it('point down by default, with no turn', () => {
    expect(drawn(<Triangle kind="section" />).style.transform).toBe('')
  })

  it('turn a quarter to the left for shut (right), half for up', () => {
    expect(drawn(<Triangle kind="section" direction="right" />).style.transform).toBe('rotate(-90deg)')
    expect(drawn(<Triangle kind="picker" direction="up" />).style.transform).toBe('rotate(180deg)')
  })

  it('are one element turned: the same node and the same path before and after a change', () => {
    const { container, rerender } = render(<Triangle kind="row" direction="right" />)
    const before = container.querySelector('svg')
    const path = before?.querySelector('path')?.getAttribute('d')

    rerender(<Triangle kind="row" direction="down" />)

    const after = container.querySelector('svg')
    expect(after).toBe(before)
    expect(after?.querySelector('path')?.getAttribute('d')).toBe(path)
    expect(after?.style.transform).toBe('')
  })
})
