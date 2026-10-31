import { Tip } from '../Tooltip/Tip.js'
import './ProgressSentence.css'
import { formatDuration } from '../../../formatDuration.js'
import { copy } from '../../../locale/index.js'
import { MeterBar, PercentLabel } from '../MeterBar/MeterBar.js'
import type { PickedStatus } from '../StatusPicker/StatusPicker.js'

const SENTENCE_SIZES = {
  header: { count: 15, time: 14, percent: 15 },
  group: { count: 12, time: 12, percent: 12 },
} as const

export type ProgressSentenceSize = keyof typeof SENTENCE_SIZES

export interface ProgressSummary {
  count: string
  allDone: boolean
  /** Null on an empty list — there is nothing to say about time. */
  left: string | null
}

/**
 * One progress sentence everywhere: bar, `42%`, `16/38`, `14h 43m left` (H-024: the percentage sits beside the bar and the
 * count is the count alone, a dot between each; My Lists draws its own cluster, `HomeRow`). Finished,
 * the time field becomes `✓ All done`, or `✓ Done for now` on a list
 * flagged Ongoing — "All done" would be a lie on a series still running:
 * every item you have is watched, but the list itself is not finished
 * (design-system/components/ProgressSentence). While some lengths are still
 * being looked up (`runtimesPending`) the time left is part estimate, and
 * reads `≈14h 43m left` (task 15.7).
 */
export function formatProgress(
  done: number,
  total: number,
  minutesLeft: number,
  status: PickedStatus,
  runtimesPending = 0,
): ProgressSummary {
  const allDone = total > 0 && done === total
  const count = copy.quantum.progress.count(done, total)

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
  size = 'group',
  runtimesPending = 0,
}: ProgressSentenceProps) {
  const { count, allDone, left } = formatProgress(done, total, minutesLeft, status, runtimesPending)
  const sizes = SENTENCE_SIZES[size]

  return (
    <div className={size === 'header' ? 'q-progress header' : 'q-progress'}>
      <MeterBar done={done} total={total} big={size === 'header'} />
      <PercentLabel done={done} total={total} px={sizes.percent} />
      <span className="q-sep">·</span>
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
