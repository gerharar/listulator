import { useState } from 'react'
import { api, type ListSourceResult, type MediaType } from '../lib/api.js'

/**
 * Finds something that can become a whole list, and builds it.
 *
 * The search is for *sources* rather than individual items — you look up
 * Jackie Chan and get the filmography, rather than adding films one at a time.
 */
export function SourceSearch({
  mediaType,
  onBuilt,
}: {
  mediaType: MediaType
  onBuilt: (listId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ListSourceResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  /** Which source is being built — importing can take seconds. */
  const [building, setBuilding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (!query.trim()) return

    setSearching(true)
    setError(null)
    setResults(null)

    try {
      setResults((await api.searchSources(mediaType.key, query.trim())).sources)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function build(source: ListSourceResult) {
    setBuilding(source.externalRef)
    setError(null)

    try {
      const list = await api.createFromSource({
        mediaType: mediaType.key,
        externalRef: source.externalRef,
        title: source.title,
      })

      onBuilt(list.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build that list')
      setBuilding(null)
    }
  }

  return (
    <section className="panel">
      <header className="panel__header">
        <h2 className="panel__title">Search {mediaType.label}</h2>
      </header>

      <form className="source-search" onSubmit={(event) => void search(event)}>
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={PLACEHOLDERS[mediaType.key] ?? 'Search…'}
          aria-label={`Search ${mediaType.label}`}
        />
        <button className="button" type="submit" disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="notice notice--error">{error}</p>}

      {building && (
        // TMDB fetches a runtime per film, so a big filmography takes seconds.
        // Silence here reads as a hang.
        <p className="panel__empty">Building the list — this can take a few seconds…</p>
      )}

      {!building && results?.length === 0 && (
        <p className="panel__empty">Nothing found. Try a different spelling, or add by hand below.</p>
      )}

      {!building && results && results.length > 0 && (
        <ul className="rows">
          {results.map((source) => (
            <li key={source.externalRef}>
              <button type="button" className="row source" onClick={() => void build(source)}>
                <span className="row__title">{source.title}</span>
                {source.detail && <span className="small faint">{source.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Nudges toward searching for a source, which is not the obvious thing to type. */
const PLACEHOLDERS: Record<string, string> = {
  movie: 'An actor, director, or a film series…',
  music: 'A band or artist…',
  book: 'An author…',
}
