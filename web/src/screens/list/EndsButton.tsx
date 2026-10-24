import './EndsButton.css'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import type { ListEnd } from './listEnds.js'

export interface EndsButtonProps {
  atTop: boolean
  atBottom: boolean
  onGo: (end: ListEnd) => void
}

/**
 * The split Up / Down button (H-019): one box in the toolbar, two halves, no text. Each half takes the reader to an end of the list, like Home
 * and End do (the keys are the equivalent for a target this small); at its end a half is disabled.
 */
export function EndsButton({ atTop, atBottom, onGo }: EndsButtonProps) {
  const text = copy.quantum.list.ends

  return (
    <div className="q-ends" role="group" aria-label={text.group} data-bar-fixed="">
      <Tip as="button" type="button" className="q-ends-half" aria-label={text.toTop} text={text.topTip} disabled={atTop} onClick={() => onGo('top')}>
        <ArrowUp width={12} height={12} strokeWidth={2} aria-hidden="true" />
      </Tip>
      <Tip as="button" type="button" className="q-ends-half" aria-label={text.toBottom} text={text.bottomTip} disabled={atBottom} onClick={() => onGo('bottom')}>
        <ArrowDown width={12} height={12} strokeWidth={2} aria-hidden="true" />
      </Tip>
    </div>
  )
}
