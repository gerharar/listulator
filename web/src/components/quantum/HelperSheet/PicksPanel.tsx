import { formatDuration } from '../../../formatDuration.js'
import type { MediaType, SuggestionPick } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { Spinner } from '../Spinner/Spinner.js'
import { useLiveRegion } from '../LiveRegion/LiveRegion.js'
import { useState } from 'react'
import type { HelperAnswer } from './useHelperAnswer.js'
import { pickKey, pickSource, reroll } from './helperPicks.js'

export interface PicksPanelProps {
  answer: HelperAnswer
  /** The one-line why for the top pick. */
  why: (pick: SuggestionPick) => string
  /** What to say when there is nothing to offer. */
  empty: string
  onRetry: () => void
  onOpenList: (listId: string) => void
  /** The registry, so a pick can name the source its list arrived from. */
  mediaTypes?: readonly MediaType[]
}

/**
 * The body every helper sheet shares (design: "Each pick shows the top result,
 * a one-line why, and reroll / open actions"): loading, failed, nothing, or the
 * pick with Not That and Open The List. The alternates the design also listed are
 * gone (owner, 11.11); Not That still walks every pick the server sent.
 */
export function PicksPanel({ answer, why, empty, onRetry, onOpenList, mediaTypes }: PicksPanelProps) {
  const text = copy.quantum.helper

  if (answer.phase === 'loading') {
    return (
      <div className="q-helper-progress">
        <Spinner label={text.loading} />
        <span>{text.loading}</span>
      </div>
    )
  }

  if (answer.phase === 'failed') {
    return (
      <div className="q-helper-note">
        <p>{text.failed}</p>
        <Button onClick={onRetry}>{text.retry}</Button>
      </div>
    )
  }

  if (answer.phase !== 'ready') return null
  if (answer.picks.length === 0) return <p className="q-helper-note">{empty}</p>

  return <Picks picks={answer.picks} why={why} onOpenList={onOpenList} mediaTypes={mediaTypes} />
}

function Picks({
  picks,
  why,
  onOpenList,
  mediaTypes,
}: {
  picks: SuggestionPick[]
  why: PicksPanelProps['why']
  onOpenList: (listId: string) => void
  mediaTypes: readonly MediaType[] | undefined
}) {
  const text = copy.quantum.helper
  const { announce } = useLiveRegion()
  const [rejected, setRejected] = useState<string[]>([])
  const shown = reroll(picks, rejected).shown
  const top = shown[0]!

  const time = (pick: SuggestionPick) => (pick.nextItem ? formatDuration(pick.nextItem.timeToConsumeMinutes) : null)
  const line = (pick: SuggestionPick) => [pick.list.title, time(pick), pickSource(pick, mediaTypes)].filter(Boolean).join(' · ')

  function notThat() {
    const next = [...rejected, pickKey(top)]

    if (reroll(picks, next).exhausted) {
      setRejected([])
      announce(text.backToStrongest)
    } else {
      setRejected(next)
    }
  }

  return (
    <div className="q-pick">
      <div className="q-kicker">{text.topPick}</div>
      <div className="q-pick-item">{top.nextItem?.title ?? top.list.title}</div>
      <div className="q-pick-list">{line(top)}</div>
      <div className="q-pick-why">{why(top)}</div>
      <div className="q-pick-actions">
        <Button variant="primary" onClick={() => onOpenList(top.list.id)}>
          {text.openList}
        </Button>
        <Button onClick={notThat}>{text.notThat}</Button>
      </div>
    </div>
  )
}
