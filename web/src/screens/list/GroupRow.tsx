import './Spine.css'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { copy } from '../../locale/index.js'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { yearSpanLabel, type GroupBlock } from './spine.js'

export interface GroupRowProps {
  block: GroupBlock
  collapsed: boolean
  /** The list's one tab stop (roving focus). */
  focusable: boolean
  onToggle: (name: string) => void
  onFocus: (groupId: string) => void
  /** A drag starts here: the handle's own pointer-down (10.23). Only a group with items has a handle. */
  onHandlePointerDown?: (event: PointerEvent) => void
  dragging?: boolean
  /** The drop line, when a drag would land just above or just below this group. */
  dropLine?: 'before' | 'after' | null
  /** Just moved or restored. */
  pulse?: boolean
  /** Deletes the group. Offered only while it holds no items (prototype: "🗑 empty"). */
  onDelete?: () => void
  /** While a filter is on: how many of the group's items match, in place of its progress. */
  shownOf?: { shown: number; total: number }
}

/**
 * A group's header (design-system/components/GroupRow): a composite item with
 * its own progress, sticky while its items are on screen. Clicking toggles it
 * open or closed. Its handle drags the whole block (10.23); an empty group has a
 * delete button of its own.
 */
export function GroupRow({
  block,
  collapsed,
  focusable,
  onToggle,
  onFocus,
  onHandlePointerDown,
  dragging = false,
  dropLine = null,
  pulse = false,
  onDelete,
  shownOf,
}: GroupRowProps) {
  const span = yearSpanLabel(block.yearSpan)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(block.group.name)
    }
  }

  return (
    <div
      className={['q-group', block.allDone && 'complete', dragging && 'dragging', pulse && 'pulse']
        .filter(Boolean)
        .join(' ')}
      role="button"
      aria-expanded={!collapsed}
      data-row-id={block.group.id}
      data-drag-key={block.group.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => onToggle(block.group.name)}
      onKeyDown={onKeyDown}
      onFocus={() => onFocus(block.group.id)}
    >
      {dropLine && <span className={dropLine === 'after' ? 'q-dropline after' : 'q-dropline'} />}
      {block.items.length > 0 && (
        <span
          className="q-handle"
          aria-hidden="true"
          title={copy.quantum.list.itemActions.dragGroup}
          onPointerDown={(event) => onHandlePointerDown?.(event)}
          onClick={(event) => event.stopPropagation()}
        >
          ⣿
        </span>
      )}
      <span className="q-chev" aria-hidden="true">
        ▼
      </span>
      <span className="name">
        <b>{block.group.name}</b>
        {span && <span className="q-year">{span}</span>}
      </span>
      {block.items.length === 0 && onDelete && (
        <button
          type="button"
          className="q-group-delete"
          aria-label={copy.quantum.list.itemActions.deleteGroupAria}
          title={copy.quantum.list.itemActions.deleteGroupTip}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Trash2 width={13} height={13} strokeWidth={1.8} aria-hidden="true" />
          {copy.quantum.list.itemActions.deleteGroupLabel}
        </button>
      )}
      {shownOf ? (
        <div className="q-progress">
          <span className="q-count" style={{ fontSize: 13 }}>
            {copy.quantum.list.filter.groupShown(shownOf.shown, shownOf.total)}
          </span>
        </div>
      ) : (
        <ProgressSentence
          done={block.done}
          total={block.total}
          minutesLeft={block.minutesLeft}
          status={null}
          size="group"
        />
      )}
    </div>
  )
}
