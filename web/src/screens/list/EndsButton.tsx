import './EndsButton.css'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import type { ListEnd } from './listEnds.js'

export interface EndsButtonProps {
  atTop: boolean
  atBottom: boolean
  /** Every row fits in the view: both halves are disabled, and the group says why (a disabled half has no tooltip of its own). */
  inView: boolean
  onGo: (end: ListEnd) => void
}

/**
 * The split Up / Down button (H-019): one box in the toolbar, two halves, no text. Each half takes the reader to an end of the list, like Home
 * and End do (the keys are the equivalent for a target this small); at its end a half is disabled, and both are while the whole list is in view,
 * when the halves keep quiet and the pointer over either gets the group's tooltip.
 */
export function EndsButton({ atTop, atBottom, inView, onGo }: EndsButtonProps) {
  const text = copy.quantum.list.ends

  return (
    <Tip as="div" className="q-ends" role="group" aria-label={text.group} text={inView ? text.inView : undefined} describe data-bar-fixed="">
      <Tip as="button" type="button" className="q-ends-half" aria-label={text.toTop} text={inView ? undefined : text.topTip} disabled={inView || atTop} onClick={() => onGo('top')}>
        <ArrowUp width={12} height={12} strokeWidth={2} aria-hidden="true" />
      </Tip>
      <Tip as="button" type="button" className="q-ends-half" aria-label={text.toBottom} text={inView ? undefined : text.bottomTip} disabled={inView || atBottom} onClick={() => onGo('bottom')}>
        <ArrowDown width={12} height={12} strokeWidth={2} aria-hidden="true" />
      </Tip>
    </Tip>
  )
}
