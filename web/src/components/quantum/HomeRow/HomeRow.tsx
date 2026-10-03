import { Tip } from '../Tooltip/Tip.js'
import './HomeRow.css'
import { ByHandMark, CuratedStar, NewBadge } from '../Marks/Marks.js'
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
  /** Items that arrived with a sync and are not yet marked seen (`stats.newItems`); none, or `undefined`, renders no badge. */
  newCount?: number
  /** Items whose length is still being looked up (`stats.runtimesPending`, 15.7): the time left is then approximate. */
  runtimesPending?: number
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
  newCount,
  runtimesPending,
  onOpen,
}: HomeRowProps) {
  return (
    <button type="button" className="q-home-row" onClick={onOpen}>
      <Tip className="name" text={description ?? undefined}>
        {mark === 'curated' && <CuratedStar />}
        {mark === 'byHand' && <ByHandMark />}
        <span className="title">{title}</span>
        <StatusMark status={status} />
        {newCount ? <NewBadge count={newCount} /> : null}
      </Tip>
      <ProgressSentence
        done={done}
        total={total}
        minutesLeft={minutesLeft}
        status={status}
        size="row"
        {...(runtimesPending ? { runtimesPending } : {})}
      />
    </button>
  )
}
