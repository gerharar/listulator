import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { SourceSearch } from '../components/SourceSearch.js'
import { api, type MediaType } from '../lib/api.js'
import { formatDuration } from '../formatDuration.js'
import { categoryDescription, categoryLabel, copy } from '../locale/index.js'

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
      setError(cause instanceof Error ? cause.message : copy.newList.createFailed)
      setSaving(false)
    }
  }

  return (
    <>
      <Link className="back" to="/">
        {copy.listDetail.back}
      </Link>

      <div className="page__header">
        <h1 className="page__title">{copy.newList.title}</h1>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <section className="panel">
        <div style={{ padding: 'var(--space-4)' }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">{copy.newList.categoryLabel}</span>
            <select
              className="select"
              value={mediaType}
              onChange={(event) => setMediaType(event.target.value)}
            >
              {mediaTypes.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {categoryLabel(candidate)}
                  {candidate.searchAvailable ? '' : copy.newList.noSearchSuffix}
                </option>
              ))}
            </select>
            {category && categoryDescription(category) && (
              // Some categories are not self-explanatory from a label alone —
              // "Mega" least of all. Its own block: hints are inline spans, so
              // two of them run into one sentence.
              <p className="field__hint">{categoryDescription(category)}</p>
            )}
            <span className="field__hint">{copy.newList.builtInHint}</span>
          </label>
        </div>
      </section>

      {category?.searchAvailable && (
        <SourceSearch mediaType={category} onBuilt={(listId) => void navigate(`/lists/${listId}`)} />
      )}

      <form className="panel" onSubmit={(event) => void submit(event)}>
        <header className="panel__header">
          <h2 className="panel__title">
            {category?.searchAvailable ? copy.newList.orByHandHeading : copy.newList.byHandHeading}
          </h2>
        </header>
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
              {titles.length > 0
                ? copy.newList.itemCount(titles.length)
                : copy.newList.itemsOptional}
              {category
                ? copy.newList.assumedDuration(formatDuration(category.defaultDurationMinutes))
                : ''}
            </span>
          </label>

          <button className="button button--primary" type="submit" disabled={saving || !title.trim()}>
            {saving ? copy.newList.creating : copy.newList.create}
          </button>
        </div>
      </form>
    </>
  )
}
