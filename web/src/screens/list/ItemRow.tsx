import './Spine.css'
import type { KeyboardEvent, MouseEvent } from 'react'
import { Info, Pencil, Trash2 } from 'lucide-react'
import { formatDuration } from '../../formatDuration.js'
import { copy } from '../../locale/index.js'
import type { ListItem } from '../../lib/api.js'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { DoneCheckbox } from '../../components/quantum/DoneCheckbox/DoneCheckbox.js'
import { KindTag, ManualMark, NewBadge } from '../../components/quantum/Marks/Marks.js'

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
  /** The row's own buttons; each gets the button, to anchor a popover to. */
  onInfo: (item: ListItem, anchor: HTMLElement) => void
  onEdit: (item: ListItem, anchor: HTMLElement) => void
  onRemove: (item: ListItem, anchor: HTMLElement) => void
  /** Just added, moved or restored: wash the row so the eye can find where it went. */
  pulse: boolean
}

/**
 * One 46px band (design-system/components/ItemRow), read-only for now: the
 * done box, the kind tag, the title with its year, and the runtime. Clicking
 * anywhere on the row toggles done. The drag handle comes with task 10.23.
 */
export function ItemRow({
  item,
  grouped,
  focusable,
  minutesWidth,
  onToggle,
  onFocus,
  onInfo,
  onEdit,
  onRemove,
  pulse,
}: ItemRowProps) {
  const text = copy.quantum.list.itemActions
  const done = item.consumedAt !== null
  const kind = item.tags?.[0]

  /** A row button acts on its own: it must not also toggle the row it sits in. */
  const act =
    (handler: (item: ListItem, anchor: HTMLElement) => void) => (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      handler(item, event.currentTarget)
    }

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
      className={['q-item', grouped && 'in-group', done && 'is-done', pulse && 'pulse']
        .filter(Boolean)
        .join(' ')}
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
        {/* ⓘ and ✎ sit in the title's own group (the prototype's), so they get its 9px gap. */}
        <IconButton size="row" className="info" label={text.details(item.title)} onClick={act(onInfo)}>
          <Info width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
        <IconButton size="row" className="edit" label={text.edit(item.title)} onClick={act(onEdit)}>
          <Pencil width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      </span>
      {item.isNew && <NewBadge />}
      <span className="spacer" />
      <span className="q-mins" style={{ width: `${minutesWidth}ch` }}>
        {formatDuration(item.timeToConsumeMinutes)}
      </span>
      <IconButton size="row" className="remove" label={text.remove(item.title)} onClick={act(onRemove)}>
        <Trash2 width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
    </div>
  )
}
