import { api } from '../../../lib/api.js'
import { copy } from '../../../locale/index.js'
import { AskingSheet } from './AskingSheet.js'
import { whyJustOneFix } from './helperPicks.js'

export interface JustOneFixSheetProps {
  open: boolean
  onClose: () => void
  onOpenList: (listId: string) => void
}

const fetchPicks = () => api.justOneFix()

/**
 * Just One Fix: the shortest unfinished item anywhere, each list offered by its
 * own shortest one (the engine's item-level `just-one-fix` strategy).
 */
export function JustOneFixSheet(props: JustOneFixSheetProps) {
  const text = copy.quantum.helper.justOneFix

  return <AskingSheet {...props} title={text.title} explain={text.explain} fetchPicks={fetchPicks} why={whyJustOneFix} />
}
