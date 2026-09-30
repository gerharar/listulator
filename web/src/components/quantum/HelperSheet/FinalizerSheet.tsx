import { api, type MediaType } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { AskingSheet } from './AskingSheet.js'
import { whyFinalizer } from './helperPicks.js'

export interface FinalizerSheetProps {
  open: boolean
  onClose: () => void
  onOpenList: (listId: string) => void
  /** The registry, so a pick can name the source its list arrived from. */
  mediaTypes?: readonly MediaType[]
}

const fetchPicks = () => api.finalizer()

/**
 * Finalizer — "Finish Him!": tie up loose ends by offering the list closest to
 * done, complete lists before unknown ones before ongoing ones (the engine's
 * `finalizer` strategy).
 */
export function FinalizerSheet(props: FinalizerSheetProps) {
  const text = copy.quantum.helper.finalizer

  return <AskingSheet {...props} title={text.title} explain={text.explain} fetchPicks={fetchPicks} why={whyFinalizer} />
}
