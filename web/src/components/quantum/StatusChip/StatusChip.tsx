import './StatusChip.css'
import { Archive, Footprints } from 'lucide-react'
import { copy } from '../../../locale/index.js'
import { STATUS_PICKER_OPTIONS, type PickedStatus } from '../StatusPicker/StatusPicker.js'

export interface StatusChipData {
  value: 'complete' | 'ongoing'
  label: string
  /**
   * The same consequence sentence StatusPicker shows under its buttons —
   * read from `STATUS_PICKER_OPTIONS` rather than duplicated through
   * locale, so the two surfaces can't drift apart (see docs/DECISIONS.md).
   */
  note: string
  tip: string
}

const NOTE_BY_VALUE: Record<'complete' | 'ongoing', string> = {
  complete: STATUS_PICKER_OPTIONS.find((option) => option.value === 'complete')!.note,
  ongoing: STATUS_PICKER_OPTIONS.find((option) => option.value === 'ongoing')!.note,
}

/**
 * A list's status is a claim about the *source*, not about progress:
 * "complete" means the series is finished and the list will not grow,
 * "ongoing" means more is coming. Blank means nobody knows, so there is no
 * "Unknown" chip anywhere — only an absent one (design-system/components/StatusChip).
 */
export function statusChipData(status: PickedStatus): StatusChipData | null {
  if (status !== 'complete' && status !== 'ongoing') return null

  const label = status === 'ongoing' ? copy.quantum.status.ongoing : copy.quantum.status.complete
  const note = NOTE_BY_VALUE[status]
  return { value: status, label, note, tip: `${label} — ${note}` }
}

export interface StatusChipProps {
  status: PickedStatus
  /** The compact form used in a SearchResultRow. */
  short?: boolean
}

/** The full/short text chip — beside a list's title, or in a search result row. */
export function StatusChip({ status, short = false }: StatusChipProps) {
  const data = statusChipData(status)
  if (!data) return null

  const className = ['q-status', data.value === 'ongoing' && 'ongoing', short && 'short']
    .filter(Boolean)
    .join(' ')

  return <span className={className}>{data.label}</span>
}

export interface StatusMarkProps {
  status: PickedStatus
}

/**
 * The 19×19 icon form used on a HomeRow: an archive box (closed run) or
 * footprints (still going). Not a tick — the tick is spoken for by
 * done-ness elsewhere, and status is not progress.
 */
export function StatusMark({ status }: StatusMarkProps) {
  const data = statusChipData(status)
  if (!data) return null

  const className = ['q-status-mark', data.value === 'ongoing' && 'ongoing']
    .filter(Boolean)
    .join(' ')
  const Icon = data.value === 'ongoing' ? Footprints : Archive
  const size = data.value === 'ongoing' ? 12 : 13

  return (
    <span className={className} title={data.tip} aria-label={data.label}>
      <Icon width={size} height={size} strokeWidth={2.1} aria-hidden="true" />
    </span>
  )
}
