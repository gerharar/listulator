import './MeterBar.css'
import type { CSSProperties } from 'react'
import { copy } from '../../../locale/index.js'

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
  const className = ['q-meter', big && 'lg', full && 'full'].filter(Boolean).join(' ')

  return (
    <span
      className={className}
      style={{ '--n': n, '--f': f } as CSSProperties}
      role="img"
      aria-label={copy.quantum.meter.label(done, total)}
      title={meterCellNote(total)}
    />
  )
}
