import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type MediaType } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'
import { copy } from '../locale/index.js'

/** One item per line; blank lines ignored so pasted text needs no tidying. */
export function parseItemTitles(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/**
 * The Create layer's "Add by hand" tab (design: Add by hand). The category is
 * already chosen — the Category picker (task 10.11) did that — so this is
 * only title and items. Replaced by the real Add-by-hand tab in task 10.13.
 */
export function ByHandForm({ mediaType }: { mediaType: MediaType | undefined }) {
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [itemsText, setItemsText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const titles = parseItemTitles(itemsText)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!mediaType) return
    setError(null)
    setSaving(true)

    try {
      const list = await api.createList({ title: title.trim(), mediaType: mediaType.key })

      if (titles.length > 0) {
        await api.importItems(
          list.id,
          titles.map((line) => ({ title: line })),
          'manual',
        )
      }

      // Replaces the create layer rather than stacking on top of it — the
      // create flow succeeded, so there is nothing to go "back" to (task 10.9).
      void navigate(`/lists/${list.id}`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.newList.createFailed)
      setSaving(false)
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      {error && <p className="notice notice--error">{error}</p>}
      <div style={{ padding: 'var(--space-4)' }}>
        <label className="field">
          <span className="field__label">{copy.newList.listTitleLabel}</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={copy.newList.listTitlePlaceholder}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field__label">{copy.newList.itemsLabel}</span>
          <textarea
            className="textarea"
            value={itemsText}
            onChange={(event) => setItemsText(event.target.value)}
            placeholder={copy.newList.itemsPlaceholder}
          />
          <span className="field__hint">
            {titles.length > 0 ? copy.newList.itemCount(titles.length) : copy.newList.itemsOptional}
            {mediaType
              ? copy.newList.assumedDuration(formatDuration(mediaType.defaultDurationMinutes))
              : ''}
          </span>
        </label>

        <button
          className="button button--primary"
          type="submit"
          disabled={saving || !title.trim() || !mediaType}
        >
          {saving ? copy.newList.creating : copy.newList.create}
        </button>
      </div>
    </form>
  )
}
