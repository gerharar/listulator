import { useEffect } from 'react'
import { api } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { Sheet } from '../Sheet/Sheet.js'
import { PicksPanel } from './PicksPanel.js'
import { useHelperAnswer } from './useHelperAnswer.js'
import { whyFinalizer } from './helperPicks.js'

export interface FinalizerSheetProps {
  open: boolean
  onClose: () => void
  onOpenList: (listId: string) => void
}

/**
 * Finalizer — "Finish Him!": tie up loose ends by offering the list closest to
 * done, complete lists before unknown ones before ongoing ones (the engine's
 * `finalizer` strategy). Nothing to name: it asks as soon as it opens.
 */
export function FinalizerSheet(props: FinalizerSheetProps) {
  return props.open ? <OpenSheet {...props} /> : null
}

function OpenSheet({ onClose, onOpenList }: FinalizerSheetProps) {
  const text = copy.quantum.helper
  const { answer, run, retry } = useHelperAnswer()

  useEffect(() => run(() => api.finalizer()), [run])

  return (
    <Sheet open onClose={onClose} title={text.finalizer.title} explain={text.finalizer.explain} plateSeed={6}>
      <PicksPanel
        answer={answer}
        why={whyFinalizer}
        empty={text.nothingUnfinished}
        onRetry={retry}
        onOpenList={onOpenList}
      />
    </Sheet>
  )
}
