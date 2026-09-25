import './ItemEditPopover.css'
import { useState } from 'react'
import type { ListItem } from '../../lib/api.js'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Field } from '../../components/quantum/Field/Field.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { GroupCombobox } from './GroupCombobox.js'
import { buildEditPatch, type ItemPatch } from './itemActions.js'

export interface ItemEditPopoverProps {
  item: ListItem
  /** The list's groups, in order. */
  groups: readonly string[]
  anchorEl: HTMLElement | null
  /**
   * The edits to apply. `save` is the explicit button; `clickaway` is the
   * safety net, which the caller answers with an Undo toast.
   */
  onCommit: (patch: ItemPatch, via: 'save' | 'clickaway') => void
  /** Closed without changing anything. */
  onDiscard: () => void
}

/**
 * The ✎ popover (design: item edit, 360px): Title, Minutes, Group, and
 * Discard / Save. Clicking away or pressing Esc commits what can be saved —
 * "the buttons are the contract; the click-away is the safety net". There is
 * no field for `notes`: they are curator prose and read-only.
 */
export function ItemEditPopover({ item, groups, anchorEl, onCommit, onDiscard }: ItemEditPopoverProps) {
  const text = copy.quantum.list.itemActions
  const [title, setTitle] = useState(item.title)
  const [minutes, setMinutes] = useState(String(item.timeToConsumeMinutes))
  const [group, setGroup] = useState(item.group ?? '')

  const patch = buildEditPatch(item, { title, minutes, group })

  function dismiss() {
    if (patch) onCommit(patch, 'clickaway')
    else onDiscard()
  }

  return (
    <Popover open anchorEl={anchorEl} onDismiss={dismiss} width={360}>
      <div className="q-edit">
        <Field
          label={text.editTitle}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          size="sm"
        />
        <Field
          label={text.editMinutes}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          inputMode="numeric"
          size="sm"
        />
        <GroupCombobox label={text.editGroup} groups={groups} value={group} onChange={setGroup} small />
        <div className="q-edit-actions">
          <Button size="sm" variant="quiet" onClick={onDiscard}>
            {text.discard}
          </Button>
          <Button size="sm" variant="primary" disabled={!patch} onClick={() => patch && onCommit(patch, 'save')}>
            {text.save}
          </Button>
        </div>
      </div>
    </Popover>
  )
}
