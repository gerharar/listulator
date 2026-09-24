import './Spine.css'
import type { KeyboardEvent } from 'react'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { yearSpanLabel, type GroupBlock } from './spine.js'

export interface GroupRowProps {
  block: GroupBlock
  collapsed: boolean
  /** The list's one tab stop (roving focus). */
  focusable: boolean
  onToggle: (name: string) => void
  onFocus: (groupId: string) => void
}

/**
 * A group's header (design-system/components/GroupRow): a composite item with
 * its own progress, sticky while its items are on screen. Clicking toggles it
 * open or closed. Delete (empty groups) and the drag handle come with 10.21
 * and 10.23.
 */
export function GroupRow({ block, collapsed, focusable, onToggle, onFocus }: GroupRowProps) {
  const span = yearSpanLabel(block.yearSpan)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(block.group.name)
    }
  }

  return (
    <div
      className={['q-group', block.allDone && 'complete'].filter(Boolean).join(' ')}
      role="button"
      aria-expanded={!collapsed}
      data-row-id={block.group.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onToggle(block.group.name)}
      onKeyDown={onKeyDown}
      onFocus={() => onFocus(block.group.id)}
    >
      <span className="q-chev" aria-hidden="true">
        ▾
      </span>
      <span className="name">
        <b>{block.group.name}</b>
        {span && <span className="q-year">{span}</span>}
      </span>
      <ProgressSentence
        done={block.done}
        total={block.total}
        minutesLeft={block.minutesLeft}
        status={null}
        size="group"
      />
    </div>
  )
}
