import './AddItemForm.css'
import { useRef, useState, type FormEvent } from 'react'
import { copy } from '../../locale/index.js'
import { Button } from '../../components/quantum/Button/Button.js'
import { ErrorStrip } from '../../components/quantum/ErrorStrip/ErrorStrip.js'
import { Field } from '../../components/quantum/Field/Field.js'
import { GroupCombobox } from './GroupCombobox.js'

/**
 * Whole minutes as typed. Blank is `null` — use the category's default and
 * mark it estimated — and anything that is not a whole number is `NaN`.
 */
export function parseMinutes(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

export interface NewItemInput {
  title: string
  /** `null`: the category's default, estimated. */
  minutes: number | null
  /** Empty: no group. A name the list lacks creates the group. */
  group: string
}

export interface AddItemFormProps {
  /** The list's groups, in order. */
  groups: readonly string[]
  defaultMinutes: number
  onAdd: (input: NewItemInput) => Promise<void>
}

/**
 * The add-item form at the foot of the list (design: "Add item form"): title,
 * minutes, and a group you pick or type. The item lands at the end of its
 * group (BL-003). The group stays after adding, so a run of items into one
 * group is one field filled in once.
 */
export function AddItemForm({ groups, defaultMinutes, onAdd }: AddItemFormProps) {
  const text = copy.quantum.list.addItem
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState('')
  const [group, setGroup] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleInput = useRef<HTMLInputElement>(null)

  const parsed = parseMinutes(minutes)
  const valid = title.trim() !== '' && !Number.isNaN(parsed)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!valid || adding) return
    setError(null)
    setAdding(true)

    try {
      await onAdd({ title: title.trim(), minutes: parsed, group: group.trim() })
      setTitle('')
      setMinutes('')
      titleInput.current?.focus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.failed)
    } finally {
      setAdding(false)
    }
  }

  return (
    <form className="q-add-item" onSubmit={(event) => void submit(event)}>
      {error && (
        <ErrorStrip message={error} onRetry={() => setError(null)} onDismiss={() => setError(null)} />
      )}
      <div className="q-add-item-row">
        <Field
          ref={titleInput}
          label={text.titleLabel}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={text.titlePlaceholder}
          spellCheck={false}
          autoComplete="off"
          disabled={adding}
          size="sm"
        />
        <Field
          label={text.minutesLabel}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          placeholder={String(defaultMinutes)}
          inputMode="numeric"
          disabled={adding}
          size="sm"
          className="q-add-item-minutes"
        />
        <GroupCombobox label={text.groupLabel} groups={groups} value={group} onChange={setGroup} small />
        <Button variant="primary" size="sm" type="submit" disabled={!valid} busy={adding} busyLabel={text.adding}>
          {text.add}
        </Button>
      </div>
    </form>
  )
}
