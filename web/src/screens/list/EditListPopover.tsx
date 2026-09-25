import './ItemEditPopover.css'
import { useState } from 'react'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Field, FieldTextArea } from '../../components/quantum/Field/Field.js'
import { Popover } from '../../components/quantum/Popover/Popover.js'
import { StatusPicker } from '../../components/quantum/StatusPicker/StatusPicker.js'
import { buildListPatch, type ListFields, type ListPatch } from './listActions.js'

export interface EditListPopoverProps {
  list: ListFields
  /** For the head row's count, as on the other list popovers. */
  itemCount: number
  anchorEl: HTMLElement | null
  /** `save` is the explicit button; `clickaway` is the safety net, answered with an Undo toast. */
  onCommit: (patch: ListPatch, via: 'save' | 'clickaway') => void
  /** Closed without changing anything. */
  onDiscard: () => void
}

/**
 * The ✎ popover beside the list's name (design: Edit list, 320px): Title,
 * Description and the three-button status row, with Discard / Save. Like the
 * item editor, clicking away or pressing Esc commits what can be saved — the
 * buttons are the contract, the click-away the safety net.
 *
 * Spelling is checked in the description (prose) and not in the title, which
 * is usually a proper noun.
 */
export function EditListPopover({ list, itemCount, anchorEl, onCommit, onDiscard }: EditListPopoverProps) {
  const text = copy.quantum.list.editPopover
  const [title, setTitle] = useState(list.title)
  const [description, setDescription] = useState(list.description ?? '')
  const [status, setStatus] = useState(list.status)

  const patch = buildListPatch(list, { title, description, status })

  function dismiss() {
    if (patch) onCommit(patch, 'clickaway')
    else onDiscard()
  }

  return (
    <Popover open anchorEl={anchorEl} onDismiss={dismiss} width={320}>
      <div className="q-edit">
        <div className="q-pop-head">
          <span className="q-kicker">{text.kicker}</span>
          <span className="q-kicker" style={{ letterSpacing: 0 }}>
            {copy.quantum.list.moreMenu.itemCount(itemCount)}
          </span>
        </div>
        <Field
          label={text.title}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          size="sm"
        />
        <FieldTextArea
          label={text.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder={text.descriptionPlaceholder}
        />
        <div className="q-field">
          <span className="q-kicker">{text.status}</span>
          <StatusPicker value={status} onChange={setStatus} />
        </div>
        <div className="q-edit-actions">
          <Button size="sm" variant="quiet" onClick={onDiscard}>
            {copy.quantum.list.itemActions.discard}
          </Button>
          <Button size="sm" variant="primary" disabled={!patch} onClick={() => patch && onCommit(patch, 'save')}>
            {copy.quantum.list.itemActions.save}
          </Button>
        </div>
      </div>
    </Popover>
  )
}
