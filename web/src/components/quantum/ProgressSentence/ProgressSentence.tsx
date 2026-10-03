import { Tip } from '../Tooltip/Tip.js'
import './ProgressSentence.css'
import { useState } from 'react'
import { formatDuration } from '../../../formatDuration.js'
import { copy } from '../../../locale/index.js'
import { MeterBar, meterCellNote, meterCellsPerItem, METER_CELL_CAP } from '../MeterBar/MeterBar.js'
import { Popover } from '../Popover/Popover.js'
import type { PickedStatus } from '../StatusPicker/StatusPicker.js'

const SENTENCE_SIZES = {
  header: { count: 15, time: 14 },
  row: { count: 13, time: 13 },
  group: { count: 12, time: 12 },
} as const

export type ProgressSentenceSize = keyof typeof SENTENCE_SIZES

export interface ProgressSummary {
  count: string
  allDone: boolean
  /** Null on an empty list — there is nothing to say about time. */
  left: string | null
}

/**
 * One progress sentence everywhere: `16/38 (42%) · 14h 43m left`. Finished,
 * the time field becomes `✓ All done`, or `✓ Done for now` on a list
 * flagged Ongoing — "All done" would be a lie on a series still running:
 * every item you have is watched, but the list itself is not finished
 * (design-system/components/ProgressSentence). While some lengths are still
 * being looked up (`runtimesPending`) the time left is part estimate, and
 * reads `≈ 14h 43m left` (task 15.7).
 */
export function formatProgress(
  done: number,
  total: number,
  minutesLeft: number,
  status: PickedStatus,
  runtimesPending = 0,
): ProgressSummary {
  const allDone = total > 0 && done === total
  const percent = total ? Math.round((done / total) * 100) : 0
  const count = copy.quantum.progress.count(done, total, percent)

  const left = !total
    ? null
    : allDone
      ? status === 'ongoing'
        ? copy.quantum.progress.doneForNow
        : copy.quantum.progress.allDone
      : runtimesPending > 0
        ? copy.quantum.progress.leftApprox(formatDuration(minutesLeft))
        : copy.quantum.progress.left(formatDuration(minutesLeft))

  return { count, allDone, left }
}

export interface ProgressSentenceProps {
  done: number
  total: number
  minutesLeft: number
  status: PickedStatus
  size?: ProgressSentenceSize
  /** How many items' lengths are still being looked up (15.7): the time left is then approximate, with a tooltip saying so. */
  runtimesPending?: number
}

export function ProgressSentence({
  done,
  total,
  minutesLeft,
  status,
  size = 'row',
  runtimesPending = 0,
}: ProgressSentenceProps) {
  const { count, allDone, left } = formatProgress(done, total, minutesLeft, status, runtimesPending)
  const sizes = SENTENCE_SIZES[size]
  const text = copy.quantum.meter
  // Only the header bar is a click hint — a button explaining the cells (U6, owner:
  // matches the prototype). The row and group bars are the plain span they've always been.
  const [explainAnchor, setExplainAnchor] = useState<HTMLButtonElement | null>(null)

  return (
    <div className={size === 'header' ? 'q-progress header' : 'q-progress'}>
      {size === 'header' ? (
        <>
          <Tip
            as="button"
            type="button"
            className="q-meter-explain"
            aria-label={text.explainHint}
            text={meterCellNote(total)}
            describe
            onClick={(event) => setExplainAnchor((was) => (was ? null : event.currentTarget))}
          >
            <MeterBar done={done} total={total} big tooltip={false} />
          </Tip>
          <Popover
            open={explainAnchor !== null}
            anchorEl={explainAnchor}
            onDismiss={() => setExplainAnchor(null)}
            width={300}
            side="below"
            label={text.explainHint}
          >
            <span className="q-kicker">{meterCellNote(total)}</span>
            <span className="q-pop-note">
              {total > METER_CELL_CAP ? text.detailCapped(METER_CELL_CAP, meterCellsPerItem(total)) : text.detailUncapped}
            </span>
          </Popover>
        </>
      ) : (
        <MeterBar done={done} total={total} />
      )}
      <span className="q-count" style={{ fontSize: sizes.count }}>
        {count}
      </span>
      {left !== null && (
        <>
          <span className="q-sep">·</span>
          <Tip
            className={allDone ? 'q-left all-done' : 'q-left'}
            style={{ fontSize: allDone ? Math.max(11, sizes.time - 2) : sizes.time }}
            text={!allDone && runtimesPending > 0 ? copy.quantum.progress.runtimesPendingTip(runtimesPending) : undefined}
          >
            {left}
          </Tip>
        </>
      )}
    </div>
  )
}
