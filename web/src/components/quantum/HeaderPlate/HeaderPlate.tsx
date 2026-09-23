import './HeaderPlate.css'
import type { CSSProperties } from 'react'
import type { Skin } from '../../../lib/preferences/skin.js'

export type PlateSide = 'left' | 'right'
export type PlateVariant = 1 | 2 | 3 | 4 | 5

/**
 * Each skin owns one header treatment — picking a skin picks the plate too
 * (design-system/components/HeaderPlate, ported from the reference engine's
 * `SKIN_PLATE`).
 */
export const SKIN_PLATE_VARIANT: Record<Skin, PlateVariant> = {
  'dark-orange': 1,
  'dark-violet': 2,
  'dark-green': 3,
  'dark-blue': 4,
  'light-bone': 5,
}

export interface PlateParams {
  variant: PlateVariant
  /** The anchored-corner base angle: 104° left, 256° right. */
  dir: number
  /** Absent for variant 5 — the Band gradient is fixed, not angle/seed-driven. */
  wrapAngle?: number
  hatchAngle?: number | readonly [number, number, number]
  hatchPeriod?: number | readonly [number, number, number]
  /** Variant 2 only — the scanline direction alternates on seed parity. */
  scanlineAngle?: number
  scanlinePeriod?: number
  /** Variant 4 only — the vertical rule-texture pitch. */
  rulePeriod?: number
  /** Variant 5 only — how far the one wide arc sits from the anchored edge. */
  arcOffset?: number
}

/**
 * The same maths the CSS (`HeaderPlate.css`, ported from bundle.css) computes
 * itself via `calc()` from `--sd`/`--dir` — this function exists so that
 * maths can be unit-tested against the reference engine's own values,
 * independent of rendering (no test renderer touches actual layout).
 */
export function plateParams(skin: Skin, side: PlateSide, seed: number): PlateParams {
  const variant = SKIN_PLATE_VARIANT[skin]
  const dir = side === 'left' ? 104 : 256

  switch (variant) {
    case 1:
      return {
        variant,
        dir,
        wrapAngle: dir + seed * 4,
        hatchAngle: 118 + seed * 9,
        hatchPeriod: 22 + seed * 3,
      }
    case 2:
      return {
        variant,
        dir,
        wrapAngle: dir - 10 + seed * 6,
        hatchAngle: 101 + seed * 13,
        hatchPeriod: 37 + seed * 4,
        scanlineAngle: seed % 2 ? 182 : 178,
        scanlinePeriod: 9 + seed * 2,
      }
    case 3:
      return {
        variant,
        dir,
        wrapAngle: dir + seed * 7,
        hatchAngle: [17 + seed * 5, -41 - seed * 3, 78 + seed * 4],
        hatchPeriod: [23 + seed, 37 + seed, 53 + seed],
      }
    case 4:
      return {
        variant,
        dir,
        wrapAngle: dir + seed * 4,
        hatchPeriod: 25 + seed * 3,
        rulePeriod: 7 + seed,
      }
    case 5:
      return {
        variant,
        dir,
        hatchAngle: 64 + seed * 4,
        hatchPeriod: 25 + seed * 3,
        arcOffset: 18 + seed * 40,
      }
  }
}

export interface HeaderPlateProps {
  side: PlateSide
  /** Nudges every angle/period so two headers in the same skin never resolve to the same pattern. Never reuse a seed across screens. */
  seed: number
  /** Corner marks (dark-violet's crosshair) — only where the corner is genuinely empty. */
  marks?: boolean
  /** A helper sheet's wash-only treatment — no hatch, no marks. */
  wash?: boolean
}

/**
 * The skin's header pattern, absolutely positioned behind a layer header's
 * (or a sheet's) own content. The variant, colours and all seed-driven
 * maths live entirely in `HeaderPlate.css`, cascading off the active
 * `data-theme` — this component only carries `data-side`/`data-marks`/`--sd`.
 */
export function HeaderPlate({ side, seed, marks = false, wash = false }: HeaderPlateProps) {
  const className = ['q-plate', wash && 'q-wash'].filter(Boolean).join(' ')

  return (
    <span
      className={className}
      data-side={side}
      data-marks={marks ? '' : undefined}
      style={{ '--sd': seed } as CSSProperties}
      aria-hidden="true"
    >
      <i className="h" />
      <i className="a1" />
      <i className="a2" />
    </span>
  )
}
