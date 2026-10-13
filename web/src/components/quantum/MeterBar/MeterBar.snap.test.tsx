// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { OverlayManagerProvider } from '../overlay/OverlayManagerContext.js'
import { MeterBar, meterCellSizes } from './MeterBar.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SCALES = [1, 1.1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3]
const whole = (cssPx: number, scale: number) => Math.abs(cssPx * scale - Math.round(cssPx * scale)) < 1e-9

describe('meterCellSizes: cells and gaps in whole device pixels (1.0.1, owner: uneven gaps on Windows at 125%)', () => {
  it.each(SCALES)('at %sx the cell, the gap and so the pitch are each a whole number of device pixels', (scale) => {
    for (const nominal of [7, 14]) {
      const { cell, gap } = meterCellSizes(nominal, scale)

      expect(whole(cell, scale)).toBe(true)
      expect(whole(gap, scale)).toBe(true)
      expect(cell).toBeGreaterThan(0)
      expect(gap).toBeGreaterThan(0)
    }
  })

  it('is the design’s own 7px cell and 2px gap wherever those already fall on device pixels', () => {
    for (const scale of [1, 2, 3]) {
      expect(meterCellSizes(7, scale)).toEqual({ cell: 7, gap: 2 })
      expect(meterCellSizes(14, scale)).toEqual({ cell: 14, gap: 2 })
    }
  })

  it('at 125%: an 8-device-pixel cell with a 3-device-pixel gap (the old 8.75 and 2.5 split unevenly)', () => {
    const { cell, gap } = meterCellSizes(7, 1.25)

    expect(Math.round(cell * 1.25)).toBe(8)
    expect(Math.round(gap * 1.25)).toBe(3)
  })

  it('keeps the pitch within a tenth of the designed 9px (a bar must not visibly change size)', () => {
    for (const scale of SCALES) {
      const { cell, gap } = meterCellSizes(7, scale)

      expect(Math.abs(cell + gap - 9) / 9).toBeLessThan(0.1)
    }
  })

  it('never lets a cell or a gap vanish at a tiny scale', () => {
    const { cell, gap } = meterCellSizes(7, 0.25)

    expect(cell * 0.25).toBeGreaterThanOrEqual(1)
    expect(gap * 0.25).toBeGreaterThanOrEqual(1)
  })
})

function bar(big = false): HTMLElement {
  const { container } = render(
    <OverlayManagerProvider>
      <MeterBar done={8} total={20} big={big} />
    </OverlayManagerProvider>,
  )
  return container.querySelector<HTMLElement>('.q-meter')!
}

describe('the bar uses those sizes for the screen it is on', () => {
  it('sets the cell and pitch from the device pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 1.25)
    const { cell, gap } = meterCellSizes(7, 1.25)

    const el = bar()

    expect(el.style.getPropertyValue('--w')).toBe(`${cell}px`)
    expect(el.style.getPropertyValue('--pitch')).toBe(`${cell + gap}px`)
  })

  it('sizes the big header bar from its own 14px', () => {
    vi.stubGlobal('devicePixelRatio', 1.25)
    const { cell } = meterCellSizes(14, 1.25)

    expect(bar(true).style.getPropertyValue('--w')).toBe(`${cell}px`)
  })

  it('follows a change of the ratio (a zoom, or a window dragged to another screen)', () => {
    let notify: () => void = () => undefined
    vi.stubGlobal('devicePixelRatio', 1)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: (_type: string, listener: () => void) => void (notify = listener),
        removeEventListener: () => undefined,
      })),
    )
    const el = bar()
    expect(el.style.getPropertyValue('--w')).toBe('7px')

    vi.stubGlobal('devicePixelRatio', 1.25)
    act(() => notify())

    expect(el.style.getPropertyValue('--w')).toBe(`${meterCellSizes(7, 1.25).cell}px`)
  })
})
