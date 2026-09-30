import { useEffect } from 'react'
import type { MediaType, SuggestionPick } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Sheet } from '../Sheet/Sheet.js'
import { PicksPanel } from './PicksPanel.js'
import { useHelperAnswer } from './useHelperAnswer.js'

export interface AskingSheetProps {
  open: boolean
  onClose: () => void
  onOpenList: (listId: string) => void
  title: string
  explain: string
  /** The request this helper makes the moment it opens. */
  fetchPicks: () => Promise<{ picks: SuggestionPick[] }>
  /** The one-line why for the top pick. */
  why: (pick: SuggestionPick) => string
  /** The registry, so a pick can name the source its list arrived from. */
  mediaTypes?: readonly MediaType[]
}

/**
 * A helper with nothing to name (Finalizer, Just One Fix): a sheet that asks as
 * soon as it opens and shows the picks. Rendered only while open, so closing it
 * forgets what was turned down and reopening asks afresh.
 */
export function AskingSheet(props: AskingSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null
}

function OpenSheet({ onClose, onOpenList, title, explain, fetchPicks, why, mediaTypes }: AskingSheetProps) {
  const { answer, run, retry } = useHelperAnswer()

  useEffect(() => run(fetchPicks), [run, fetchPicks])

  return (
    <Sheet open onClose={onClose} title={title} explain={explain} plateSeed={6}>
      <PicksPanel
        answer={answer}
        why={why}
        empty={copy.quantum.helper.nothingUnfinished}
        onRetry={retry}
        mediaTypes={mediaTypes}
        onOpenList={onOpenList}
      />
    </Sheet>
  )
}
