import './AddByHandTab.css'
import { useRef, useState, type FormEvent } from 'react'
import { api, type MediaType } from '../../../lib/api.js'
import { parseHandItems } from '../../../lib/handItems.js'
import { formatDuration } from '../../../formatDuration.js'
import { copy } from '../../../locale/index.js'
import { Button } from '../Button/Button.js'
import { ErrorStrip } from '../ErrorStrip/ErrorStrip.js'
import { Field, FieldTextArea } from '../Field/Field.js'
import { StatusPicker, type PickedStatus } from '../StatusPicker/StatusPicker.js'

export interface AddByHandTabProps {
  mediaType: MediaType
  /** Called with the new list's id once it is made. */
  onBuilt: (listId: string) => void
}

/**
 * Titles are proper nouns, so the OS must not underline or "correct" them
 * (the desktop check found WKWebView doing exactly that on the Search query).
 * The description is prose, so it keeps the browser's own spellcheck.
 */
const NAMES = { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off' } as const

/**
 * The Create layer's Add-by-hand tab (design: "Add by hand", task 10.13). The
 * category is already chosen, so this is the list's own details and its
 * items, one per line, with groups opened by a colon or a heading.
 *
 * Items go in as `manual`, so the list has no upstream to Reset from, and
 * carry no runtime: the category's default applies and is marked estimated.
 */
export function AddByHandTab({ mediaType, onBuilt }: AddByHandTabProps) {
  const text = copy.quantum.addByHand

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [itemsText, setItemsText] = useState('')
  const [status, setStatus] = useState<PickedStatus>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The list exists after the first step; a Retry after a failed import must
  // not make a second one.
  const created = useRef<string | null>(null)

  const { items, groups } = parseHandItems(itemsText)

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving || !title.trim()) return
    setError(null)
    setSaving(true)

    try {
      created.current ??= (
        await api.createList({
          title: title.trim(),
          mediaType: mediaType.key,
          description: description.trim() || null,
          status,
        })
      ).id

      if (items.length > 0) await api.importItems(created.current, items, 'manual')

      onBuilt(created.current)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text.createFailed)
      setSaving(false)
    }
  }

  return (
    <form className="q-hand" onSubmit={(event) => void submit(event)}>
      {error && (
        <ErrorStrip message={error} onRetry={() => void submit()} onDismiss={() => setError(null)} />
      )}

      <Field
        label={text.titleLabel}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={text.titlePlaceholder}
        {...NAMES}
        disabled={saving}
        autoFocus
      />
      <FieldTextArea
        label={text.descriptionLabel}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={text.descriptionPlaceholder}
        rows={2}
        disabled={saving}
      />
      <div>
        <FieldTextArea
          label={text.itemsLabel}
          value={itemsText}
          onChange={(event) => setItemsText(event.target.value)}
          placeholder={text.itemsPlaceholder}
          rows={8}
          {...NAMES}
          disabled={saving}
        />
        <p className="q-hand-hint t-small">{text.itemsHint}</p>
      </div>

      <div className="q-field">
        <span className="q-kicker">{text.statusLabel}</span>
        <StatusPicker value={status} onChange={setStatus} />
      </div>

      <div className="q-hand-actions">
        <Button
          variant="primary"
          type="submit"
          disabled={!title.trim()}
          busy={saving}
          busyLabel={text.creating}
        >
          {text.create}
        </Button>
        <span className="q-hand-count t-small">
          {items.length > 0 ? text.count(items.length, groups.length) : text.noItems}
          {items.length > 0 &&
            ` · ${text.assumedDuration(formatDuration(mediaType.defaultDurationMinutes))}`}
        </span>
      </div>
    </form>
  )
}
