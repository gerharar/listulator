import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type MediaType } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'

/** One item per line; blank lines ignored so pasted text needs no tidying. */
export function parseItemTitles(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function NewList({ mediaTypes }: { mediaTypes: MediaType[] }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const requested = searchParams.get('mediaType')
  const [mediaType, setMediaType] = useState(
    requested && mediaTypes.some((candidate) => candidate.key === requested)
      ? requested
      : (mediaTypes[0]?.key ?? ''),
  )
  const [title, setTitle] = useState('')
  const [itemsText, setItemsText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const category = mediaTypes.find((candidate) => candidate.key === mediaType)
  const titles = parseItemTitles(itemsText)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const list = await api.createList({ title: title.trim(), mediaType })

      if (titles.length > 0) {
        await api.importItems(
          list.id,
          titles.map((line) => ({ title: line })),
        )
      }

      void navigate(`/lists/${list.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the list')
      setSaving(false)
    }
  }

  return (
    <>
      <Link className="back" to="/">
        ← All lists
      </Link>

      <div className="page__header">
        <h1 className="page__title">New list</h1>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <form className="panel" onSubmit={(event) => void submit(event)}>
        <div style={{ padding: 'var(--space-4)' }}>
          <label className="field">
            <span className="field__label">Category</span>
            <select
              className="select"
              value={mediaType}
              onChange={(event) => setMediaType(event.target.value)}
            >
              {mediaTypes.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Categories are built in — if one is missing, it has to be added to the app itself.
            </span>
          </label>

          <label className="field">
            <span className="field__label">List title</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="All Jackie Chan movies"
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span className="field__label">Items — one per line</span>
            <textarea
              className="textarea"
              value={itemsText}
              onChange={(event) => setItemsText(event.target.value)}
              placeholder={'Drunken Master\nPolice Story\nProject A'}
            />
            <span className="field__hint">
              {titles.length > 0
                ? `${titles.length} ${titles.length === 1 ? 'item' : 'items'}.`
                : 'Optional — you can add items later.'}
              {category
                ? ` Each is assumed to take about ${formatDuration(category.defaultDurationMinutes)}, which you can correct later.`
                : ''}
            </span>
          </label>

          <button className="button button--primary" type="submit" disabled={saving || !title.trim()}>
            {saving ? 'Creating…' : 'Create list'}
          </button>
        </div>
      </form>
    </>
  )
}
