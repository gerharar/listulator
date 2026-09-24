import './HomeRow.css'
import { ByHandMark, CuratedStar } from '../Marks/Marks.js'
import { StatusMark } from '../StatusChip/StatusChip.js'
import { ProgressSentence } from '../ProgressSentence/ProgressSentence.js'
import type { PickedStatus } from '../StatusPicker/StatusPicker.js'

export interface HomeRowProps {
  title: string
  /** Shown as the name group's own native `title` tooltip — never a second line (design-system/components/HomeRow). */
  description: string | null
  mark: 'curated' | 'byHand' | null
  status: PickedStatus
  done: number
  total: number
  minutesLeft: number
  /**
   * Item count new since the last sync check — `undefined` renders no
   * badge at all. Left unwired until task 10.17 supplies a real per-list
   * count; `/lists/updates` (task 7.6) only ever returns which lists
   * changed, not how many items.
   */
  newCount?: number
  onOpen: () => void
}

/**
 * One list on My Lists, on one line (design-system/components/HomeRow):
 * marks, name, status, the cell bar, the count, and time left.
 */
export function HomeRow({
  title,
  description,
  mark,
  status,
  done,
  total,
  minutesLeft,
  onOpen,
}: HomeRowProps) {
  return (
    <button type="button" className="q-home-row" onClick={onOpen}>
      <span className="name" title={description ?? undefined}>
        {mark === 'curated' && <CuratedStar />}
        {mark === 'byHand' && <ByHandMark />}
        <span className="title">{title}</span>
        <StatusMark status={status} />
      </span>
      <ProgressSentence done={done} total={total} minutesLeft={minutesLeft} status={status} size="row" />
    </button>
  )
}
