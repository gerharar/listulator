import { NAME_MAX_LENGTH } from '../../../../server/src/catalog/limits.js'
import './Spine.css'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { IconButton } from '../../components/quantum/Button/Button.js'
import { ApiError } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { FieldMessage } from '../../components/quantum/Field/FieldMessage.js'
import { ProgressSentence } from '../../components/quantum/ProgressSentence/ProgressSentence.js'
import { yearSpanLabel, type GroupBlock } from './spine.js'
import { Tip } from '../../components/quantum/Tooltip/Tip.js'
import { guardRename } from './renameGuard.js'

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
  /** A block is carried over this group, open, collapsed or empty: it is the drop target, and its header takes a tint of its own (H-009, H-016). */
  target?: boolean
  /** On a list drawn as a window: where this group is, as hidden text for a screen reader ("Group 3 of 50", Phase 25.6). Absent on a short list. */
  place?: string
  /** Just moved or restored. */
  pulse?: boolean
  /** Deletes the group. Offered only while it holds no items (prototype: "🗑 empty"). */
  onDelete?: () => void
  /** A group with items: its trash button asks first (a confirmation anchored to it), owner 2026-09-27. */
  onDeleteWithItems?: (anchor: HTMLElement) => void
  /** While a filter is on: how many of the group's items match, in place of its progress. */
  /** While a matching filter (text, a facet) leaves only some of the group's rows: how many. The progress itself is always the whole group's (H-010). */
  matched?: number
  /**
   * Gives the group a pencil that turns its name into an editor (11.18). Resolves when the rename is
   * saved and rejects when it is refused, which leaves the editor open with what was typed.
   */
  onRename?: (name: string) => Promise<void>
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
  target = false,
  place,
  pulse = false,
  onDelete,
  onDeleteWithItems,
  matched,
  onRename,
}: GroupRowProps) {
  const span = yearSpanLabel(block.yearSpan)
  const text = copy.quantum.list.itemActions
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // A name another group has is refused where it was typed, in the API's own words (H-006), not in a toast or the strip.
  const [nameError, setNameError] = useState<string | null>(null)
  const nameErrorId = useId()
  const saving = useRef(false)
  const editor = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    editor.current?.focus()
    editor.current?.select()
  }, [editing])

  // While the field is open, a click away only ends the rename: it never also presses what it landed on (H-013).
  const message = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!editing) return
    const guard = guardRename(
      () => editor.current,
      (target) => target !== null && (editor.current?.contains(target) === true || message.current?.contains(target) === true),
    )

    return guard.release
  }, [editing])

  function startEditing() {
    setDraft(block.group.name)
    setNameError(null)
    setEditing(true)
  }

  /** Enter, or focus leaving: a changed name is saved, anything else just closes. Refused: stays open. */
  async function commit() {
    if (saving.current) return
    const name = draft.trim()
    if (name === '' || name === block.group.name || !onRename) {
      setEditing(false)
      return
    }

    saving.current = true
    try {
      await onRename(name)
      setEditing(false)
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'group.nameTaken') setNameError(cause.message)
      editor.current?.focus()
    } finally {
      saving.current = false
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onToggle(block.group.name)
    }
  }

  return (
    <div
      className={['q-group', block.allDone && 'complete', dragging && 'dragging', pulse && 'pulse', target && 'is-target']
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
        <Tip
          className="q-handle"
          aria-hidden="true"
          text={copy.quantum.list.itemActions.dragGroup}
          onPointerDown={(event) => onHandlePointerDown?.(event)}
          onClick={(event) => event.stopPropagation()}
        >
          ⣿
        </Tip>
      )}
      <span className="q-chev" aria-hidden="true">
        ▼
      </span>
      <span className={editing ? 'name editing' : 'name'}>
        {editing ? (
          <input
            ref={editor}
            className="q-group-input"
            aria-label={text.groupNameLabel}
            value={draft}
            maxLength={NAME_MAX_LENGTH}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? nameErrorId : undefined}
            onChange={(event) => {
              setDraft(event.target.value)
              setNameError(null)
            }}
            onBlur={() => void commit()}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              // Typing here is not the row's: Space and Enter would fold it, arrows would walk the list.
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                void commit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setNameError(null)
                setEditing(false)
              }
            }}
          />
        ) : (
          <>
            <Tip as="b" text={block.group.name} whenClipped>
              {block.group.name}
            </Tip>
            {span && (
              <Tip className="q-year" text={copy.quantum.list.itemActions.groupYears}>
                {span}
              </Tip>
            )}
          </>
        )}
      </span>
      {onRename && !editing && (
        <IconButton
          size="row"
          className="edit q-group-rename"
          label={text.renameGroupAria(block.group.name)}
          onClick={(event) => {
            event.stopPropagation()
            startEditing()
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Pencil width={14} height={14} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      )}
      {/* The free space comes after the pencil, so it sits by the name as an item's does and the progress stays on the right (H-011); a field being typed in takes it instead. */}
      {!editing && <span className="q-group-fill" />}
      {block.items.length === 0 && onDelete && (
        <Tip
          as="button"
          type="button"
          className="q-group-delete"
          aria-label={copy.quantum.list.itemActions.deleteGroupAria}
          text={copy.quantum.list.itemActions.deleteGroupTip}
          describe
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Trash2 width={13} height={13} strokeWidth={1.8} aria-hidden="true" />
          {copy.quantum.list.itemActions.deleteGroupLabel}
        </Tip>
      )}
      <ProgressSentence
        done={block.done}
        total={block.total}
        minutesLeft={block.minutesLeft}
        status={null}
        size="group"
        lead={matched !== undefined ? copy.quantum.list.filter.groupMatched(matched) : undefined}
      />
      {block.items.length > 0 && onDeleteWithItems && (
        <IconButton
          size="row"
          className="remove q-group-remove"
          label={copy.quantum.list.itemActions.deleteGroupWithItems(block.group.name)}
          onClick={(event) => {
            event.stopPropagation()
            onDeleteWithItems(event.currentTarget)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Trash2 width={15} height={15} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      )}
      {editing && nameError && (
        <span className="q-group-msg" ref={message}>
          <FieldMessage id={nameErrorId} text={nameError} />
        </span>
      )}
      {place && <span className="q-place">{place}</span>}
    </div>
  )
}
