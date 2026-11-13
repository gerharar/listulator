import { Tip } from '../Tooltip/Tip.js'
import './ProgressSentence.css'
import { formatDuration } from '../../../formatDuration.js'
import { copy } from '../../../locale/index.js'
import { MeterBar, PercentLabel } from '../MeterBar/MeterBar.js'
import type { PickedStatus } from '../StatusPicker/StatusPicker.js'
import { LeftText } from './LeftText.js'
import { useTheme } from '../DocumentTheme/ThemeContext.js'

const SENTENCE_SIZES = {
  header: { count: 15, time: 14, percent: 15 },
  group: { count: 12, time: 12, percent: 12 },
} as const

export type ProgressSentenceSize = keyof typeof SENTENCE_SIZES

/** The Spectrum font has one body size (design, X-004), so under eX-Zed every part of the sentence is it, whatever the place (51.7). */
const SPECTRUM_SIZES = { count: 16, time: 16, percent: 16 } as const

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

/** What the list screen knows of a group, to size the columns its heads share. */
export interface GroupFigures {
  total: number
  /** Every item's minutes, done or not: the most the time left can ever read. */
  totalMinutes: number
}

/**
 * The finished state is set at 11px with 0.1em of spacing against the time's 12px, so a character is about 1.07 as wide;
 * a tenth more, so it never outgrows a column sized in 12px characters.
 */
const FINISHED_WIDTH_PER_CHAR = 11 / 10

/**
 * The longest the time left can read while items are ticked off from `totalMinutes` down to nothing. A figure of 10h passes
 * through 9h 59m, which is longer, so the column is sized by that and not by the figure it starts at.
 */
function longestTimeLeft(totalMinutes: number): number {
  const candidates = [totalMinutes]
  const hours = Math.floor((totalMinutes - 59) / 60)
  if (hours >= 1) candidates.push(hours * 60 + 59)

  return Math.max(...candidates.map((minutes) => copy.quantum.progress.left(formatDuration(minutes)).length))
}

/**
 * How many characters the count and the time left each take, at their widest, over every group of a list (BL-160). The
 * heads are right-aligned, so their bars start in one column only when these two fields are the same width on every head.
 * Sized by what each group can read at its longest, not by what it reads now, so ticking an item never moves a bar.
 */
export function groupColumnChars(groups: readonly GroupFigures[]): { count: number; left: number } {
  let count = 0
  let left = 0

  for (const { total, totalMinutes } of groups) {
    count = Math.max(count, copy.quantum.progress.count(total, total).length)
    if (total > 0) {
      left = Math.max(left, longestTimeLeft(totalMinutes), Math.ceil(copy.quantum.progress.allDone.length * FINISHED_WIDTH_PER_CHAR))
    }
  }

  return { count, left }
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
  const exzed = useTheme() === 'exzed'
  const sizes = exzed ? SPECTRUM_SIZES : SENTENCE_SIZES[size]

  // A group head's count and time sit in slots the list screen sizes for every head at once (BL-160); the header's do not.
  const slotted = size === 'group'
  const countText = (
    <span className="q-count" style={{ fontSize: sizes.count }}>
      {count}
    </span>
  )
  const leftText = left !== null && (
    <Tip
      className={allDone ? 'q-left all-done' : 'q-left'}
      style={{ fontSize: allDone && !exzed ? Math.max(11, sizes.time - 2) : sizes.time }}
      text={!allDone && runtimesPending > 0 ? copy.quantum.progress.runtimesPendingTip(runtimesPending) : undefined}
    >
      <LeftText text={left} />
    </Tip>
  )

  return (
    <div className={size === 'header' ? 'q-progress header' : 'q-progress'}>
      <MeterBar done={done} total={total} big={size === 'header'} />
      <PercentLabel done={done} total={total} px={sizes.percent} />
      <span className="q-sep">·</span>
      {slotted ? (
        <span className="q-slot count" style={{ fontSize: sizes.count }}>
          {countText}
        </span>
      ) : (
        countText
      )}
      {slotted ? (
        <>
          {/* A group with no items has no time, but keeps the dot's room and the slot's width: its bar must start where the others do. */}
          <span className="q-sep" style={left === null ? { visibility: 'hidden' } : undefined}>
            ·
          </span>
          <span className="q-slot time" style={{ fontSize: sizes.time }}>
            {leftText}
          </span>
        </>
      ) : (
        left !== null && (
          <>
            <span className="q-sep">·</span>
            {leftText}
          </>
        )
      )}
    </div>
  )
}
