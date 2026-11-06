// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useLayoutEffect, useReducer, useRef } from 'react'
import { Popover } from './Popover.js'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { tailGeometry, type TailKind } from './popoverTail.js'

afterEach(cleanup)

/**
 * The tail was two stacked CSS triangles: the `--rule` one behind and the `--card` one in front, 1px further in so the back one read as a
 * 1px rim. On a 125% Windows display (owner, 2026-11-06: "the arrow is missing the top part") the back one's borders were snapped to whole
 * device pixels (9px became 8.8px) while the front one's `top: -9px` and `left: 1px` were not, and the tail sat at 29.5 device pixels: the
 * front triangle fell a pixel off the back one, covering the upper rim (one faint pixel) and doubling the lower (three bright ones). One
 * drawing, both shapes in one coordinate system, cannot drift apart; jsdom cannot lay anything out, so this pins the drawing.
 */
const KINDS: readonly TailKind[] = ['left', 'right', 'up', 'down']

/** The numbers of a path made only of M, L and Z, as [x, y] points. */
function points(d: string): [number, number][] {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

describe('the popover tail’s drawing', () => {
  it.each(KINDS)('%s: the fill is the rim’s triangle moved exactly 1px toward the card', (kind) => {
    const { rim, fill } = tailGeometry(kind)
    const [a, b] = [points(rim), points(fill)]
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(3)
    const shifts = a.map(([x, y], i) => [b[i]![0] - x, b[i]![1] - y])
    // The same shift on every corner: the fill is the rim's shape, not a different one.
    for (const s of shifts) expect(s).toEqual(shifts[0])
    expect(Math.abs(shifts[0]![0]!) + Math.abs(shifts[0]![1]!)).toBe(1)
  })

  it('left and right tails are 9 x 18, up and down 18 x 9, the design’s size', () => {
    for (const kind of ['left', 'right'] as const) expect(tailGeometry(kind)).toMatchObject({ width: 9, height: 18 })
    for (const kind of ['up', 'down'] as const) expect(tailGeometry(kind)).toMatchObject({ width: 18, height: 9 })
  })

  it('moves toward the card: right of a left tail, left of a right tail, below an up tail, above a down tail', () => {
    const shift = (kind: TailKind) => {
      const { rim, fill } = tailGeometry(kind)
      return [points(fill)[0]![0] - points(rim)[0]![0], points(fill)[0]![1] - points(rim)[0]![1]]
    }
    expect(shift('left')).toEqual([1, 0])
    expect(shift('right')).toEqual([-1, 0])
    expect(shift('up')).toEqual([0, 1])
    expect(shift('down')).toEqual([0, -1])
  })
})

describe('the popover tail in the card', () => {
  it('is one drawing holding the rim and the fill, with no pseudo-element to fall out of step', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null)
      const [, force] = useReducer((n: number) => n + 1, 0)
      useLayoutEffect(() => force(), [])
      return (
        <OverlayManagerProvider>
          <button ref={ref}>Open</button>
          <Popover open anchorEl={ref.current} onDismiss={vi.fn()} width={220}>
            <span>Body</span>
          </Popover>
        </OverlayManagerProvider>
      )
    }
    render(<Harness />)

    const tail = document.querySelector('.q-pop-tail')
    expect(tail).not.toBeNull()
    const drawing = tail?.querySelectorAll('svg')
    expect(drawing).toHaveLength(1)
    expect(drawing?.[0]?.getAttribute('aria-hidden')).toBe('true')
    const paths = [...(tail?.querySelectorAll('svg path') ?? [])]
    expect(paths.map((p) => p.getAttribute('class'))).toEqual(['q-pop-tail-rim', 'q-pop-tail-fill'])
  })
})
