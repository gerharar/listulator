import './MeterBar.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'
import { useDevicePixelRatio } from '../../../lib/useDevicePixelRatio.js'

/**
 * Every bar is 20 cells, each 5% of the list, whatever the list's size (H-024, owner 2026-10-31). Before, a short
 * list drew a short bar and a long one stood for blocks of items, which needed a popover to explain.
 */
export const METER_CELLS = 20

export interface MeterState {
  /** `--n`: cell count, always `METER_CELLS`. */
  n: number
  /** `--f`: filled cell count. */
  f: number
  full: boolean
}

/**
 * Lit cells are `floor(done / total × 20)`, at least 1 once anything is done and at most 19 until everything is; no
 * partial cell. Whole-number sums: float division turns 29 of 100 into 28.999… and lights a cell too few.
 */
export function meterState(done: number, total: number): MeterState {
  const full = total > 0 && done >= total
  const lit = !total || done <= 0 ? 0 : full ? METER_CELLS : Math.min(METER_CELLS - 1, Math.max(1, Math.floor((done * METER_CELLS) / total)))

  return { n: METER_CELLS, f: lit, full }
}

/**
 * The percentage beside the bar (H-024): rounded down, `100%` only when every item is done, `<1%` when something is
 * done but under 1% (a started list never reads 0%), `0%` when nothing is done and on an empty list (owner, 2026-10-31).
 */
export function meterPercent(done: number, total: number): string {
  if (!total || done <= 0) return '0%'
  if (done >= total) return '100%'
  const percent = Math.floor((done * 100) / total)

  return percent === 0 ? '<1%' : `${percent}%`
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
}

/**
 * The cell bar, drawn as **one masked element** (see MeterBar.css): a fill
 * gradient cut into segments by a repeating mask, so cells can't drift out
 * of alignment with each other the way separately-boxed cells did.
 */
export function MeterBar({ done, total, big = false }: MeterBarProps) {
  const { n, f, full } = meterState(done, total)
  const { cell, gap } = meterCellSizes(big ? 14 : 7, useDevicePixelRatio())
  const className = ['q-meter', big && 'lg', full && 'full'].filter(Boolean).join(' ')

  return (
    <span
      className={className}
      style={{ '--n': n, '--f': f, '--w': `${cell}px`, '--pitch': `${cell + gap}px` } as CSSProperties}
      role="img"
      aria-label={copy.quantum.meter.label(done, total)}
    />
  )
}

export interface PercentLabelProps {
  done: number
  total: number
  /** 15 in the list header, 13 on a My Lists row, 12 on a group head (H-024). */
  px: number
}

/** The percentage right after the bar: mono 600, tabular, `4ch` right-aligned so “100%” fits; gold when done, like the bar. */
export function PercentLabel({ done, total, px }: PercentLabelProps) {
  const full = total > 0 && done >= total

  return (
    <span className={full ? 'q-pct full' : 'q-pct'} style={{ fontSize: px }}>
      {meterPercent(done, total)}
    </span>
  )
}
