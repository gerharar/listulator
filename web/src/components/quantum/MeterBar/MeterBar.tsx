import { Tip } from '../Tooltip/Tip.js'
import './MeterBar.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'
import { useDevicePixelRatio } from '../../../lib/useDevicePixelRatio.js'

/**
 * One cell per item up to the cap; past that the bar stops growing and each
 * cell stands for a block of items. The bar must never encode list length —
 * a 38-item list drawing a longer bar than a 598-item one would make the bar
 * a lie you could read at a glance (design-system/components/MeterBar).
 */
export const METER_CELL_CAP = 20

export interface MeterState {
  /** `--n`: cell count, capped at `METER_CELL_CAP`. */
  n: number
  /** `--f`: filled cell count. */
  f: number
  full: boolean
}

export function meterState(done: number, total: number): MeterState {
  const n = Math.min(total, METER_CELL_CAP)
  const f = total ? Math.round((done / total) * n) : 0
  return { n, f, full: total > 0 && done >= total }
}

/** How many items a single cell stands for once the bar is past its cap. */
export function meterCellsPerItem(total: number): number {
  return Math.max(1, Math.ceil(total / METER_CELL_CAP))
}

export function meterCellNote(total: number): string {
  return total > METER_CELL_CAP
    ? copy.quantum.meter.noteCapped(METER_CELL_CAP, meterCellsPerItem(total))
    : copy.quantum.meter.noteUncapped
}

/** The design's gap between two cells, in CSS pixels. */
const NOMINAL_GAP = 2

/**
 * The cell and the gap, in CSS pixels, each a whole number of *device* pixels at this screen's scale. At 125% the
 * design's 7px cell and 2px gap are 8.75 and 2.5 device pixels, so the cells of one bar came out 8 or 9 pixels wide
 * with gaps of 2 or 3: uneven (owner, Windows, 1.0.1). A tile whose width is a whole number of device pixels cuts every
 * cell and gap the same width, wherever the bar sits (measured in Chromium at 125%, 150% and 175%). The pitch stays
 * within a few percent of the designed 9px; at 100%, 200% and 300% it is exactly the design's.
 */
export function meterCellSizes(nominalCell: number, scale: number): { cell: number; gap: number } {
  const gapDevice = Math.max(1, Math.round(NOMINAL_GAP * scale))
  const pitchDevice = Math.max(gapDevice + 1, Math.round((nominalCell + NOMINAL_GAP) * scale))

  return { cell: (pitchDevice - gapDevice) / scale, gap: gapDevice / scale }
}

export interface MeterBarProps {
  done: number
  total: number
  /** The 14×19 header size, vs. the 7×13 row size. */
  big?: boolean
  /** Its own hover explanation. Off inside a control that has one of its own (the header's explain button). */
  tooltip?: boolean
}

/**
 * The cell bar, drawn as **one masked element** (see MeterBar.css): a fill
 * gradient cut into segments by a repeating mask, so cells can't drift out
 * of alignment with each other the way separately-boxed cells did.
 */
export function MeterBar({ done, total, big = false, tooltip = true }: MeterBarProps) {
  const { n, f, full } = meterState(done, total)
  const { cell, gap } = meterCellSizes(big ? 14 : 7, useDevicePixelRatio())
  const className = ['q-meter', big && 'lg', full && 'full'].filter(Boolean).join(' ')

  return (
    <Tip
      className={className}
      style={{ '--n': n, '--f': f, '--w': `${cell}px`, '--pitch': `${cell + gap}px` } as CSSProperties}
      role="img"
      aria-label={copy.quantum.meter.label(done, total)}
      text={tooltip ? meterCellNote(total) : undefined}
      describe={tooltip}
    />
  )
}
