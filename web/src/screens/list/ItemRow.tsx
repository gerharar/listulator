import './Spine.css'
import type { KeyboardEvent } from 'react'
import { formatDuration } from '../../formatDuration.js'
import type { ListItem } from '../../lib/api.js'
import { DoneCheckbox } from '../../components/quantum/DoneCheckbox/DoneCheckbox.js'
import { KindTag, ManualMark } from '../../components/quantum/Marks/Marks.js'

export interface ItemRowProps {
  item: ListItem
  /** Inside a group: indented under its head. */
  grouped: boolean
  /** The list's one tab stop (roving focus). */
  focusable: boolean
  /** The runtime column, as wide as the list's longest value (`ch`). */
  minutesWidth: number
  onToggle: (item: ListItem) => void
  onFocus: (item: ListItem) => void
}

/**
 * One 46px band (design-system/components/ItemRow), read-only for now: the
 * done box, the kind tag, the title with its year, and the runtime. Clicking
 * anywhere on the row toggles done. The drag handle, the ⓘ ✎ 🗑 buttons and
 * the NEW mark come with tasks 10.23, 10.21 and 10.25.
 */
export function ItemRow({ item, grouped, focusable, minutesWidth, onToggle, onFocus }: ItemRowProps) {
  const done = item.consumedAt !== null
  const kind = item.tags?.[0]

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only when the row itself has focus, not a control inside it.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(item)
    }
  }

  return (
    <div
      className={['q-item', grouped && 'in-group', done && 'is-done'].filter(Boolean).join(' ')}
      data-row-id={item.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onToggle(item)}
      onKeyDown={onKeyDown}
      onFocus={() => onFocus(item)}
    >
      {/* The row's own click does the toggling, so the box only has to look right. */}
      <DoneCheckbox checked={done} onChange={() => {}} label={item.title} />
      {(kind || item.source === 'manual') && (
        <span className="tags">
          {kind && <KindTag label={kind} kind />}
          {item.source === 'manual' && <ManualMark />}
        </span>
      )}
      <span className="body">
        <span className="tt">
          <span className="title" title={item.title}>
            {item.title}
          </span>
          {item.year ? <span className="q-year">({item.year})</span> : null}
        </span>
      </span>
      <span className="spacer" />
      <span className="q-mins" style={{ width: `${minutesWidth}ch` }}>
        {formatDuration(item.timeToConsumeMinutes)}
      </span>
    </div>
  )
}
