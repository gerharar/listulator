import { Tip } from '../Tooltip/Tip.js'
import './HomeRow.css'
import { useRef, type FocusEventHandler, type PointerEventHandler } from 'react'
import { copy } from '../../../locale/index.js'
import { ByHandMark, CuratedStar, NewBadge } from '../Marks/Marks.js'
import { StatusMark } from '../StatusChip/StatusChip.js'
import { LeftText } from '../ProgressSentence/LeftText.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'
import { MeterBar, PercentLabel } from '../MeterBar/MeterBar.js'
import { formatProgress } from '../ProgressSentence/ProgressSentence.js'
import { useTooltip } from '../Tooltip/useTooltip.js'
import { useTimeLeftSetting } from '../Home/TimeLeftSetting.js'
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
 * One list on My Lists, on one line (design-system/components/HomeRow; canvas H-024): marks, name, status, the NEW badge,
 * then the cluster `bar · 41% · (25/60)`. The row is a subgrid of the screen's one grid, so each column is as wide as its widest
 * cell on the screen; the cluster is the second level of it (its bar and percentage, and its count).
 *
 * By default no time left is drawn (it can be estimated, partial or missing, and everything else here is exact): it is the tooltip of
 * the cluster, on a pointer hover or on keyboard focus of the row, and the row's accessible name ends with it. With Settings → Screen →
 * Show time left in My Lists on, it is a column of its own after the count instead, and the tooltip and the name's suffix would only
 * repeat it, so they are off.
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
  const cluster = useRef<HTMLSpanElement>(null)
  const { on: showTime } = useTimeLeftSetting()
  // The Spectrum font has one body size (16px, design X-004): its percentage and time left are not the 11 to 13px Quantum sets inline.
  const exzed = useTheme() === 'exzed'
  const { left, allDone } = formatProgress(done, total, minutesLeft, status, runtimesPending ?? 0)
  // `✓ All Done` reads as `All Done` here: the tick is the column's glyph, and a tooltip has no column.
  const time = left === null ? copy.quantum.progress.emptyList : left.replace(/^✓\s*/, '')
  const tipText = runtimesPending && left !== null && done < total ? `${time} · ${copy.quantum.progress.runtimesPendingTip(runtimesPending)}` : time
  const tip = useTooltip(showTime ? undefined : tipText, { placement: 'top-end', mono: true, anchorTo: () => cluster.current })

  // The pointer's tooltip belongs to the cluster, the keyboard's to the row (a button the cluster is not): each handler goes where it is meant.
  const { onFocus, onPointerEnter } = tip.props<{ onFocus?: FocusEventHandler<HTMLElement>; onPointerEnter?: PointerEventHandler<HTMLElement> }>({})

  return (
    <button type="button" className="q-home-row" onClick={onOpen} onFocus={onFocus}>
      <Tip className="name" text={description ?? undefined}>
        {mark === 'curated' && <CuratedStar />}
        {mark === 'byHand' && <ByHandMark />}
        <span className="title">{title}</span>
        <StatusMark status={status} />
      </Tip>
      {newCount ? <NewBadge count={newCount} /> : null}
      <span ref={cluster} className="q-home-cluster" onPointerEnter={onPointerEnter}>
        <span className="q-home-bar">
          <MeterBar done={done} total={total} />
          <PercentLabel done={done} total={total} px={exzed ? 16 : 13} />
        </span>
        <span className="q-home-count">{copy.quantum.progress.homeCount(done, total)}</span>
      </span>
      {showTime && left !== null && (
        <Tip
          className={allDone ? 'q-left all-done' : 'q-left'}
          style={{ fontSize: exzed ? 16 : allDone ? 11 : 13 }}
          text={!allDone && runtimesPending ? copy.quantum.progress.runtimesPendingTip(runtimesPending) : undefined}
        >
          <LeftText text={left} />
        </Tip>
      )}
      {/* The tooltip is for the pointer; a screen reader hears the time as the end of the row's name (unless the column says it). */}
      {!showTime && left !== null && <span className="q-home-sr">{`, ${time}`}</span>}
      {tip.node}
    </button>
  )
}
