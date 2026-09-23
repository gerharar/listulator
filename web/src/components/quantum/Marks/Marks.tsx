import './Marks.css'
import { Hand, Star } from 'lucide-react'
import { copy } from '../../../locale/index.js'

export interface CuratedStarProps {
  /** 17px in a header, vs. the default 14px. */
  large?: boolean
}

/** Kept by hand in the community library (design-system/components/Marks). */
export function CuratedStar({ large = false }: CuratedStarProps) {
  const size = large ? 17 : 14
  return (
    <span className="q-star" title={copy.quantum.marks.curated}>
      <Star width={size} height={size} fill="currentColor" stroke="none" aria-hidden="true" />
    </span>
  )
}

export interface ByHandMarkProps {
  /** 17px in a header, vs. the default 14px. */
  large?: boolean
}

/** A list made or added by hand — no source behind it. */
export function ByHandMark({ large = false }: ByHandMarkProps) {
  const size = large ? 17 : 14
  return (
    <span className="q-byhand" title={copy.quantum.marks.byHand}>
      <Hand width={size} height={size} strokeWidth={1.8} aria-hidden="true" />
    </span>
  )
}

/** A single item added by hand into an otherwise synced list — not restorable from the source. */
export function ManualMark() {
  return (
    <span className="q-manual" title={copy.quantum.marks.manual}>
      <Hand width={15} height={15} strokeWidth={1.7} aria-hidden="true" />
    </span>
  )
}

export interface NewBadgeProps {
  /** Provided on a HomeRow ("N NEW"); omitted on an ItemRow ("NEW" alone). */
  count?: number
}

export function NewBadge({ count }: NewBadgeProps) {
  const className = ['q-new', count === undefined && 'item'].filter(Boolean).join(' ')
  return (
    <span className={className}>
      {count === undefined ? copy.quantum.marks.newItem : copy.quantum.marks.newCount(count)}
    </span>
  )
}

export interface KindTagProps {
  label: string
  /** The fixed-58px preview-row variant, vs. the default facet-tag width. */
  kind?: boolean
  /** Fixed width for the default variant — widest label among the row's tags, plus 16px. */
  width?: string
}

/** Book / Game / Episode / Language facets, and a preview row's medium. */
export function KindTag({ label, kind = false, width }: KindTagProps) {
  const className = ['q-tag', kind && 'kind'].filter(Boolean).join(' ')
  return (
    <span className={className} style={!kind && width ? { width } : undefined}>
      {label}
    </span>
  )
}

/** A finished group or list. */
export function AllDoneChip() {
  return <span className="q-alldone">{copy.quantum.marks.allDone}</span>
}
