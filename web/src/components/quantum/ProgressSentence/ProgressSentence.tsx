import './ProgressSentence.css'
import { formatDuration } from '../../../formatDuration.js'
import { copy } from '../../../locale/index.js'
import { MeterBar } from '../MeterBar/MeterBar.js'
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
 * (design-system/components/ProgressSentence).
 */
export function formatProgress(
  done: number,
  total: number,
  minutesLeft: number,
  status: PickedStatus,
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
      : copy.quantum.progress.left(formatDuration(minutesLeft))

  return { count, allDone, left }
}

export interface ProgressSentenceProps {
  done: number
  total: number
  minutesLeft: number
  status: PickedStatus
  size?: ProgressSentenceSize
}

export function ProgressSentence({
  done,
  total,
  minutesLeft,
  status,
  size = 'row',
}: ProgressSentenceProps) {
  const { count, allDone, left } = formatProgress(done, total, minutesLeft, status)
  const sizes = SENTENCE_SIZES[size]

  return (
    <div className="q-progress">
      <MeterBar done={done} total={total} big={size === 'header'} />
      <span className="q-count" style={{ fontSize: sizes.count }}>
        {count}
      </span>
      {left !== null && (
        <>
          <span className="q-sep">·</span>
          <span
            className={allDone ? 'q-left all-done' : 'q-left'}
            style={{ fontSize: allDone ? Math.max(11, sizes.time - 2) : sizes.time }}
          >
            {left}
          </span>
        </>
      )}
    </div>
  )
}
