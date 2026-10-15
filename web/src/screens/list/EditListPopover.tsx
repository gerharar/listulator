import { NAME_MAX_LENGTH } from '../../../../server/src/catalog/limits.js'
import './ItemEditPopover.css'
import { useState, type KeyboardEvent } from 'react'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { Field, FieldTextArea } from '../../components/quantum/Field/Field.js'
import { useFieldValidation } from '../../components/quantum/Field/useFieldValidation.js'
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
 * item editor, clicking away commits what can be saved (Esc cancels) — the
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
  const checks = useFieldValidation({
    title: { value: title, problem: (value) => (value.trim() === '' ? text.titleRequired : null) },
  })

  // Save, Enter and a click away all end here (H-006): a blank title keeps the window open and says so, nothing changed
  // just closes.
  function commit(via: 'save' | 'clickaway') {
    if (!checks.validate()) return
    if (patch) onCommit(patch, via)
    else onDiscard()
  }

  // Enter saves, Esc cancels. Not in a text area (Enter is a new line there) and
  // not when something inside already took the key (an open group list picks with it).
  function saveOnEnter(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) return
    commit('save')
  }

  function dismiss() {
    commit('clickaway')
  }

  return (
    <Popover open anchorEl={anchorEl} onDismiss={dismiss} onEscape={onDiscard} width={320}>
      <div className="q-edit" onKeyDown={saveOnEnter}>
        <div className="q-pop-head">
          <span className="q-kicker">{text.kicker}</span>
          <span className="q-kicker" style={{ letterSpacing: 0 }}>
            {copy.quantum.list.moreMenu.itemCount(itemCount)}
          </span>
        </div>
        <Field
          label={text.title}
          maxLength={NAME_MAX_LENGTH}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          size="sm"
          {...checks.props('title')}
        />
        {checks.message('title')}
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
          <Button size="sm" variant="primary" onClick={() => commit('save')}>
            {copy.quantum.list.itemActions.save}
          </Button>
        </div>
      </div>
    </Popover>
  )
}
